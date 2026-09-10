import Capacitor
import CoreFoundation
import CryptoKit
import Foundation
import PencilKit
import UIKit
import WebKit

// Main-canvas contract:
//   CSS point = frame.origin + (document point * scale) + pan.
// frame and gesture centers use WKWebView viewport CSS coordinates, not document
// coordinates or physical pixels. Only drawingData replaces ink. JS persists it.
// Native operations are FIFO and wait for the current tool gesture. Viewport-only
// configurations apply during navigation; drawing replacements wait for its end.
// A new session flushes the old one first and returns it as previousSnapshot.
// Revisions increase for the lifetime of the controller, including explicit loads.
// Consumers must compare BOTH sessionId and revision before accepting callbacks.
// Snapshot errors reject promises / emit inkSurfaceError, never substitute empty ink.
// changedBounds is the union of added/removed/edited stroke render bounds since
// the preceding serialized revision. It is stable for repeat reads of a revision;
// JS accumulates these regions until AI consumes them. Empty ink can have a
// non-null changedBounds after clear/erase. It is NOT the preview placement rect.
private let inkBinaryLimit = 16 * 1024 * 1024
private let inkPngLimit = 12 * 1024 * 1024
private let inkPixelLimit = 16 * 1024 * 1024
private let inkDimensionLimit = 4_096
private let inkDocumentSize: CGFloat = 20_000

private struct InkSurfaceError: LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }

    static func invalid(_ name: String) -> InkSurfaceError {
        InkSurfaceError(code: "ink_surface_invalid_options", message: "Invalid ink surface option: \(name).")
    }
}

private func inkNumber(_ value: Any?, _ name: String) throws -> CGFloat {
    guard let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite else { throw InkSurfaceError.invalid(name) }
    return CGFloat(number.doubleValue)
}

private func inkHexColor(_ color: UIColor) -> String {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    color.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
        .getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    func component(_ value: CGFloat) -> Int { Int((min(1, max(0, value)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", component(red), component(green), component(blue))
}

private func inkBoolean(_ value: Any?, _ name: String, fallback: Bool? = nil) throws -> Bool {
    if value == nil, let fallback { return fallback }
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
        throw InkSurfaceError.invalid(name)
    }
    return number.boolValue
}

private func inkSession(_ call: CAPPluginCall) throws -> String {
    guard let value = call.getString("sessionId"), !value.isEmpty,
          value.utf8.count <= 256,
          value.rangeOfCharacter(from: .controlCharacters) == nil else {
        throw InkSurfaceError.invalid("sessionId")
    }
    return value
}

private struct InkSurfaceSettings {
    let sessionId: String
    let frame: CGRect
    let viewportWidth: CGFloat
    let pan: CGPoint
    let scale: CGFloat
    let visible: Bool
    let inputEnabled: Bool
    let fingerDrawing: Bool
    let navigationLocked: Bool
    let tool: String
    let colorHex: String
    let color: UIColor
    let width: CGFloat
    let toolRequestId: Int
    let drawingData: String?
    let exclusions: [CGRect]

    init(_ call: CAPPluginCall) throws {
        sessionId = try inkSession(call)
        guard let rect = call.getObject("frame") else { throw InkSurfaceError.invalid("frame") }
        frame = CGRect(
            x: try inkNumber(rect["x"], "frame.x"),
            y: try inkNumber(rect["y"], "frame.y"),
            width: try inkNumber(rect["width"], "frame.width"),
            height: try inkNumber(rect["height"], "frame.height")
        )
        viewportWidth = try inkNumber(call.getValue("viewportWidth"), "viewportWidth")
        pan = CGPoint(x: try inkNumber(call.getValue("panX"), "panX"),
                      y: try inkNumber(call.getValue("panY"), "panY"))
        scale = try inkNumber(call.getValue("scale"), "scale")
        width = try inkNumber(call.getValue("width"), "width")
        if let supplied = call.getValue("toolRequestId") {
            let requestId = try inkNumber(supplied, "toolRequestId")
            guard requestId.rounded(.towardZero) == requestId,
                  abs(requestId) <= 9_007_199_254_740_991 else {
                throw InkSurfaceError.invalid("toolRequestId (expected a safe integer)")
            }
            toolRequestId = Int(requestId)
        } else { toolRequestId = 0 }
        guard frame.width >= 0, frame.height >= 0,
              frame.width <= 100_000, frame.height <= 100_000,
              abs(frame.minX) <= 1_000_000, abs(frame.minY) <= 1_000_000,
              viewportWidth > 0, viewportWidth <= 100_000,
              abs(pan.x) <= 1_000_000, abs(pan.y) <= 1_000_000,
              scale >= 0.01, scale <= 100, width > 0, width <= 1_024,
              try inkNumber(call.getValue("canvasSize"), "canvasSize") == inkDocumentSize else {
            throw InkSurfaceError.invalid("geometry, scale, width, or canvasSize")
        }
        visible = try inkBoolean(call.getValue("visible"), "visible")
        inputEnabled = try inkBoolean(call.getValue("inputEnabled"), "inputEnabled")
        fingerDrawing = try inkBoolean(call.getValue("fingerDrawing"), "fingerDrawing", fallback: true)
        navigationLocked = try inkBoolean(call.getValue("navigationLocked"), "navigationLocked", fallback: false)
        if let supplied = call.getValue("exclusions") {
            guard let rectangles = supplied as? [Any], rectangles.count <= 128 else {
                throw InkSurfaceError.invalid("exclusions")
            }
            exclusions = try rectangles.map { entry in
                guard let rect = entry as? [String: Any] else { throw InkSurfaceError.invalid("exclusions") }
                let hole = CGRect(x: try inkNumber(rect["x"], "exclusions.x"),
                                  y: try inkNumber(rect["y"], "exclusions.y"),
                                  width: try inkNumber(rect["width"], "exclusions.width"),
                                  height: try inkNumber(rect["height"], "exclusions.height"))
                guard abs(hole.minX) <= 1_000_000, abs(hole.minY) <= 1_000_000,
                      hole.width >= 0, hole.height >= 0,
                      hole.width <= 100_000, hole.height <= 100_000 else {
                    throw InkSurfaceError.invalid("exclusions")
                }
                return hole
            }
        } else { exclusions = [] }
        guard let requestedTool = call.getString("tool"), ["pen", "eraser", "lasso"].contains(requestedTool),
              let hex = call.getString("color"),
              hex.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
              let rgb = UInt32(hex.dropFirst(), radix: 16) else {
            throw InkSurfaceError.invalid("tool or color")
        }
        tool = requestedTool
        colorHex = hex.lowercased()
        color = UIColor(red: CGFloat((rgb >> 16) & 255) / 255,
                        green: CGFloat((rgb >> 8) & 255) / 255,
                        blue: CGFloat(rgb & 255) / 255, alpha: 1)
        if let supplied = call.getValue("drawingData") {
            guard let encoded = supplied as? String, !encoded.isEmpty else {
                throw InkSurfaceError.invalid("drawingData (omit to preserve ink)")
            }
            guard encoded.utf8.count <= ((inkBinaryLimit + 2) / 3) * 4 else {
                throw InkSurfaceError(code: "ink_surface_drawing_too_large", message: "PKDrawing exceeds 16 MiB.")
            }
            drawingData = encoded
        } else {
            drawingData = nil
        }
    }

    func sameTool(as other: InkSurfaceSettings?) -> Bool {
        guard let other else { return false }
        return tool == other.tool && colorHex == other.colorHex && width == other.width
            && toolRequestId == other.toolRequestId
    }

    var nativeTool: PKTool {
        switch tool {
        case "eraser": return PKEraserTool(.bitmap)
        case "lasso": return PKLassoTool()
        default: return PKInkingTool(.pen, color: color, width: width)
        }
    }
}

private struct InkStrokeStamp {
    let digest: Data
    let bounds: CGRect

    static func make(_ drawing: PKDrawing) -> [InkStrokeStamp] {
        drawing.strokes.map { stroke in
            autoreleasepool {
                // A one-stroke archive includes path, ink, transform and erase
                // mask. Comparing only bounds misses same-size lasso/style edits.
                let data = PKDrawing(strokes: [stroke]).dataRepresentation()
                return InkStrokeStamp(digest: Data(SHA256.hash(data: data)), bounds: stroke.renderBounds)
            }
        }
    }

    static func changedBounds(from old: [InkStrokeStamp], to new: [InkStrokeStamp]) -> CGRect? {
        var counts: [Data: Int] = [:]
        for stroke in old { counts[stroke.digest, default: 0] -= 1 }
        for stroke in new { counts[stroke.digest, default: 0] += 1 }
        var bounds = CGRect.null
        for stroke in old + new where counts[stroke.digest, default: 0] != 0 {
            if !stroke.bounds.isNull, !stroke.bounds.isInfinite,
               stroke.bounds.minX.isFinite, stroke.bounds.minY.isFinite,
               stroke.bounds.width.isFinite, stroke.bounds.height.isFinite {
                bounds = bounds.union(stroke.bounds)
            }
        }
        return bounds.isNull ? nil : bounds.integral
    }
}

private func inkBoundsObject(_ bounds: CGRect?) -> JSValue {
    guard let bounds else { return NSNull() }
    return ["x": Double(bounds.minX), "y": Double(bounds.minY),
            "w": Double(bounds.width), "h": Double(bounds.height)] as JSObject
}

private struct EncodedInk {
    let drawingData: String
    let preview: String?
    let bounds: CGRect?
    let strokeCount: Int
    let metrics: JSObject
    let strokes: [InkStrokeStamp]
    let changedBounds: CGRect?

    static func decode(_ base64: String) throws -> PKDrawing {
        guard let data = Data(base64Encoded: base64), !data.isEmpty, data.count <= inkBinaryLimit else {
            throw InkSurfaceError(code: "ink_surface_invalid_drawing", message: "Expected bounded base64 PKDrawing data.")
        }
        do { return try PKDrawing(data: data) }
        catch {
            throw InkSurfaceError(code: "ink_surface_invalid_drawing", message: "PencilKit could not decode the drawing.")
        }
    }

    static func make(_ drawing: PKDrawing, previous: [InkStrokeStamp] = []) throws -> EncodedInk {
        let start = ProcessInfo.processInfo.systemUptime
        let binary = drawing.dataRepresentation()
        guard !binary.isEmpty, binary.count <= inkBinaryLimit else {
            throw InkSurfaceError(code: "ink_surface_drawing_too_large", message: "PKDrawing exceeds 16 MiB. Ink is retained; undo or erase before retrying.")
        }
        let stamps = InkStrokeStamp.make(drawing)
        let changedBounds = InkStrokeStamp.changedBounds(from: previous, to: stamps)
        var metrics: JSObject = [
            "drawingBytes": binary.count, "previewBytes": 0,
            "previewWidth": 0, "previewHeight": 0, "renderScale": 0,
        ]
        if drawing.strokes.isEmpty {
            metrics["serializationMs"] = (ProcessInfo.processInfo.systemUptime - start) * 1_000
            return EncodedInk(drawingData: binary.base64EncodedString(), preview: nil,
                              bounds: nil, strokeCount: 0, metrics: metrics,
                              strokes: stamps, changedBounds: changedBounds)
        }
        let raw = drawing.bounds
        guard !raw.isNull, !raw.isInfinite,
              raw.minX.isFinite, raw.minY.isFinite, raw.width.isFinite, raw.height.isFinite,
              raw.width > 0, raw.height > 0,
              abs(raw.minX) <= 1_000_000, abs(raw.minY) <= 1_000_000,
              abs(raw.maxX) <= 1_000_000, abs(raw.maxY) <= 1_000_000 else {
            throw InkSurfaceError(code: "ink_surface_invalid_bounds", message: "Drawing bounds cannot be rendered safely. Ink is retained.")
        }
        // Outward rounding prevents clipping ink. Extremely thin drawings get a
        // little transparent padding so their shorter raster dimension is >= 1.
        var bounds = raw.integral
        let minimumExtent = max(bounds.width, bounds.height) / CGFloat(inkDimensionLimit - 2)
        if bounds.width < minimumExtent {
            bounds = bounds.insetBy(dx: -(minimumExtent - bounds.width) / 2, dy: 0)
        }
        if bounds.height < minimumExtent {
            bounds = bounds.insetBy(dx: 0, dy: -(minimumExtent - bounds.height) / 2)
        }
        var renderScale = min(2, CGFloat(inkDimensionLimit - 1) / max(bounds.width, bounds.height),
                              sqrt(CGFloat(inkPixelLimit) / (bounds.width * bounds.height)))
        for _ in 0..<10 {
            let attempt: (Data?, Int, Int) = autoreleasepool {
                var result: (Data?, Int, Int) = (nil, 0, 0)
                // Match the explicitly colored, light native canvas on all iPads.
                UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
                    let image = drawing.image(from: bounds, scale: renderScale)
                    guard let pixels = image.cgImage,
                          pixels.width > 0, pixels.height > 0,
                          pixels.width <= inkDimensionLimit, pixels.height <= inkDimensionLimit,
                          pixels.width * pixels.height <= inkPixelLimit else { return }
                    result = (image.pngData(), pixels.width, pixels.height)
                }
                return result
            }
            if let png = attempt.0, !png.isEmpty, png.count <= inkPngLimit {
                metrics["previewBytes"] = png.count
                metrics["previewWidth"] = attempt.1
                metrics["previewHeight"] = attempt.2
                metrics["renderScale"] = Double(renderScale)
                metrics["serializationMs"] = (ProcessInfo.processInfo.systemUptime - start) * 1_000
                return EncodedInk(drawingData: binary.base64EncodedString(),
                                  preview: "data:image/png;base64,\(png.base64EncodedString())",
                                  bounds: bounds, strokeCount: drawing.strokes.count, metrics: metrics,
                                  strokes: stamps, changedBounds: changedBounds)
            }
            // Reduce only the preview, never the vector drawing or document bounds.
            renderScale *= 0.7
        }
        throw InkSurfaceError(code: "ink_surface_preview_failed", message: "A bounded transparent preview could not be generated. Ink is retained.")
    }
}

private final class InkCanvasView: PKCanvasView {
    private let drawingUndoManager = UndoManager()
    override var undoManager: UndoManager? { drawingUndoManager }
    override var canBecomeFirstResponder: Bool { true }
}

private final class InkClipView: UIView {
    var exclusions: [CGRect] = []

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        // Returning false here prevents ANY canvas subview/recognizer from taking
        // the touch; UIKit continues hit-testing the WKWebView underneath us.
        super.point(inside: point, with: event) && !exclusions.contains { $0.contains(point) }
    }
}

private struct InkToolActivity {
    let tool: String
    let startedAt: TimeInterval
    let strokeCountBefore: Int
}

final class TenetInkSurface: NSObject, PKCanvasViewDelegate, PKToolPickerObserver, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
    private let policy: () -> (enabled: Bool, finger: Bool)
    private let emit: (String, JSObject) -> Void
    private let clip = InkClipView()
    private let canvas = InkCanvasView()
    private let picker = PKToolPicker()
    private let renderQueue = DispatchQueue(label: "ai.truemade.tenet.ink-snapshot", qos: .userInitiated)
    private let panGesture = UIPanGestureRecognizer()
    private let pinchGesture = UIPinchGestureRecognizer()
    private let pencilInteraction = UIPencilInteraction()
    private var previousNativeTool: PKTool = PKInkingTool(.pen, color: .black, width: 3)
    private var lastPickerSignature: String?
    private var applyingTool = false
    private weak var webView: WKWebView?
    private var settings: InkSurfaceSettings?
    private var sessionId: String?
    private var revision = 0
    private var observedDrawing = PKDrawing()
    // Never overwritten by a failed decode/serialization. The live canvas also
    // retains edits that exceed export limits so native undo/erase can recover.
    private var latestValidDrawing = PKDrawing()
    private var cached: (session: String, revision: Int, value: EncodedInk)?
    private var changeBaseline: [InkStrokeStamp] = []
    private var baselineRevision = -1
    private var lastEmittedRevision = -1
    private var debounce: DispatchWorkItem?
    private var notifications: [NSObjectProtocol] = []
    private var operations: [(viewportOnly: Bool, run: () -> Void)] = []
    private var operationRunning = false
    private var inputSuspended = false
    private var explicitlyHidden = false
    private var applicationSuspended = false
    private var applyingDrawing = false
    private var usingTool = false
    private var toolActivity: InkToolActivity?
    private var changeRenderPending = false
    private var gestureSession: String?
    private var unitsPerCSS: CGFloat = 1
    private var viewportOffset = CGPoint.zero
    private var viewportZoom: CGFloat = 1
    private var viewportConfigured = false
    private var applyingViewport = false

    init(policy: @escaping () -> (enabled: Bool, finger: Bool), emit: @escaping (String, JSObject) -> Void) {
        self.policy = policy
        self.emit = emit
        super.init()
        clip.isOpaque = false
        clip.backgroundColor = .clear
        clip.clipsToBounds = true
        clip.isHidden = true
        canvas.isOpaque = false
        canvas.backgroundColor = .clear
        canvas.overrideUserInterfaceStyle = .light
        canvas.delegate = self
        canvas.contentInsetAdjustmentBehavior = .never
        canvas.showsHorizontalScrollIndicator = false
        canvas.showsVerticalScrollIndicator = false
        canvas.bounces = false
        canvas.bouncesZoom = false
        canvas.alwaysBounceHorizontal = false
        canvas.alwaysBounceVertical = false
        canvas.scrollsToTop = false
        canvas.minimumZoomScale = 0.0001
        canvas.maximumZoomScale = 1_000
        canvas.contentSize = CGSize(width: inkDocumentSize, height: inkDocumentSize)
        // JS is the only viewport authority. Disable built-in navigation, not
        // PKCanvasView's drawing recognizer or the scroll view's rendering.
        canvas.panGestureRecognizer.isEnabled = false
        canvas.pinchGestureRecognizer?.isEnabled = false
        canvas.undoManager?.levelsOfUndo = 30
        clip.addSubview(canvas)
        picker.stateAutosaveName = nil
        picker.showsDrawingPolicyControls = false
        picker.overrideUserInterfaceStyle = .light
        // Observe ourselves instead of letting the picker change drawingPolicy.
        // A user's Pencil preferences cannot override managed finger denial.
        picker.addObserver(self)
        panGesture.minimumNumberOfTouches = 2
        panGesture.maximumNumberOfTouches = 2
        panGesture.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        pinchGesture.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        panGesture.delegate = self
        pinchGesture.delegate = self
        panGesture.addTarget(self, action: #selector(navigatePan(_:)))
        pinchGesture.addTarget(self, action: #selector(navigatePinch(_:)))
        canvas.addGestureRecognizer(panGesture)
        canvas.addGestureRecognizer(pinchGesture)
        pencilInteraction.delegate = self
        canvas.addInteraction(pencilInteraction)
        // Do not make drawing wait for a two-finger recognizer to fail: that
        // postpones permitted one-finger ink until lift. PencilKit retains its
        // own drawing recognizer, touch arbitration and Pencil palm rejection.
        let center = NotificationCenter.default
        notifications.append(center.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshPolicyAndVisibility()
        })
        notifications.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.applicationSuspended = true
            self.refreshPolicyAndVisibility()
            self.scheduleChange()
        })
        notifications.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.applicationSuspended = false
            self?.refreshPolicyAndVisibility()
        })
    }

    deinit {
        debounce?.cancel()
        for observer in notifications { NotificationCenter.default.removeObserver(observer) }
        picker.removeObserver(self)
        canvas.delegate = nil
        clip.removeFromSuperview()
    }

    private var navigating: Bool {
        [panGesture.state, pinchGesture.state].contains { $0 == .began || $0 == .changed }
    }

    private func enqueue(_ call: CAPPluginCall, viewportOnly: Bool = false, _ body: @escaping () -> Void) {
        guard operations.count < 32 else {
            reject(call, InkSurfaceError(code: "ink_surface_busy", message: "Too many pending ink operations; await the previous call."), finish: false)
            return
        }
        operations.append((viewportOnly: viewportOnly, run: body))
        runNext()
    }

    private func runNext() {
        guard !operationRunning, !usingTool, let first = operations.first else { return }
        // Navigation is JS-driven: its configure acknowledgements must update the
        // native viewport while fingers are down, or the canvas jumps on release.
        guard !navigating || first.viewportOnly else { return }
        operationRunning = true
        operations.removeFirst().run()
    }

    private func finish() {
        operationRunning = false
        inputSuspended = false
        refreshPolicyAndVisibility()
        DispatchQueue.main.async { [weak self] in self?.runNext() }
    }

    private func reject(_ call: CAPPluginCall, _ error: Error, finish shouldFinish: Bool = true) {
        call.reject(error.localizedDescription, (error as? InkSurfaceError)?.code ?? "ink_surface_failed", error)
        if shouldFinish { finish() }
    }

    private func requireSession(_ call: CAPPluginCall) throws {
        guard try inkSession(call) == sessionId else {
            throw InkSurfaceError(code: "ink_surface_stale_session", message: "This ink operation belongs to a different session.")
        }
    }

    func configure(_ call: CAPPluginCall, above webView: WKWebView) {
        let next: InkSurfaceSettings
        do { next = try InkSurfaceSettings(call) }
        catch { reject(call, error, finish: false); return }
        enqueue(call, viewportOnly: next.sessionId == sessionId && next.drawingData == nil) { [self] in
            guard policy().enabled else {
                reject(call, InkSurfaceError(code: "pencil_disabled", message: "PencilKit is disabled by managed configuration."))
                return
            }
            guard webView.superview != nil, webView.bounds.width > 0,
                  (0.0001...1_000).contains(webView.bounds.width / next.viewportWidth * next.scale) else {
                reject(call, InkSurfaceError(code: "ink_surface_unavailable", message: "The web viewport is not laid out."))
                return
            }
            let changingSession = sessionId != nil && sessionId != next.sessionId
            let replacingDrawing = next.drawingData != nil || sessionId == nil || changingSession
            if !replacingDrawing {
                apply(next, webView: webView)
                finish()
                call.resolve(configurationResult())
                return
            }
            // Stop new input only after the current gesture has completed. Neither
            // the previous drawing nor the visible surface is removed on failure.
            inputSuspended = true
            refreshPolicyAndVisibility()
            let precedingDrawing = canvas.drawing
            let load: (JSObject?) -> Void = { [self] previous in
                renderQueue.async { [self] in
                    let result: Result<(PKDrawing, EncodedInk), Error> = Result {
                        let candidate = try next.drawingData.map { try EncodedInk.decode($0) } ?? PKDrawing()
                        let oldStrokes = changingSession ? [] : InkStrokeStamp.make(precedingDrawing)
                        return (candidate, try EncodedInk.make(candidate, previous: oldStrokes))
                    }
                    DispatchQueue.main.async { [self] in
                        switch result {
                        case .failure(let error): reject(call, error)
                        case .success(let (drawing, encoded)):
                            guard policy().enabled, webView.superview != nil else {
                                reject(call, InkSurfaceError(code: "ink_surface_unavailable", message: "The native surface became unavailable; previous ink is retained."))
                                return
                            }
                            debounce?.cancel()
                            sessionId = next.sessionId
                            replaceDrawing(drawing, resetUndo: true)
                            latestValidDrawing = drawing
                            cached = (next.sessionId, revision, encoded)
                            changeBaseline = encoded.strokes
                            baselineRevision = revision
                            lastEmittedRevision = revision
                            apply(next, webView: webView)
                            finish()
                            var response = configurationResult()
                            if let previous { response["previousSnapshot"] = previous }
                            call.resolve(response)
                        }
                    }
                }
            }
            if changingSession {
                snapshot(requireCurrent: true) { [self] result in
                    switch result {
                    case .failure(let error): reject(call, error)
                    case .success(let previous):
                        emit("inkSurfaceChanged", previous)
                        load(previous)
                    }
                }
            } else { load(nil) }
        }
    }

    func flush(_ call: CAPPluginCall, hide: Bool) {
        enqueue(call) { [self] in
            do { try requireSession(call) }
            catch { reject(call, error); return }
            inputSuspended = true
            refreshPolicyAndVisibility()
            snapshot(requireCurrent: true) { [self] result in
                switch result {
                case .failure(let error): reject(call, error)
                case .success(let value):
                    if hide {
                        explicitlyHidden = true
                        refreshPolicyAndVisibility()
                    }
                    call.resolve(value)
                    finish()
                }
            }
        }
    }

    func command(_ call: CAPPluginCall) {
        enqueue(call) { [self] in
            do { try requireSession(call) }
            catch { reject(call, error); return }
            guard policy().enabled else {
                reject(call, InkSurfaceError(code: "pencil_disabled", message: "PencilKit is disabled by managed configuration."))
                return
            }
            guard let command = call.getString("command"), ["undo", "redo", "clear"].contains(command) else {
                reject(call, InkSurfaceError.invalid("command")); return
            }
            inputSuspended = true
            refreshPolicyAndVisibility()
            switch command {
            case "undo": canvas.undoManager?.undo()
            case "redo": canvas.undoManager?.redo()
            default:
                if !canvas.drawing.strokes.isEmpty { undoableReplace(PKDrawing()) }
            }
            observeDrawing()
            snapshot(requireCurrent: true) { [self] result in
                switch result {
                case .failure(let error): reject(call, error)
                case .success(let value):
                    emitChanged(value)
                    call.resolve(value)
                    finish()
                }
            }
        }
    }

    private func replaceDrawing(_ drawing: PKDrawing, resetUndo: Bool) {
        applyingDrawing = true
        canvas.undoManager?.disableUndoRegistration()
        canvas.drawing = drawing
        canvas.undoManager?.enableUndoRegistration()
        if resetUndo { canvas.undoManager?.removeAllActions() }
        observedDrawing = canvas.drawing
        revision += 1
        cached = nil
        applyingDrawing = false
    }

    private func undoableReplace(_ drawing: PKDrawing) {
        let previous = canvas.drawing
        canvas.undoManager?.registerUndo(withTarget: self) { target in target.undoableReplace(previous) }
        canvas.undoManager?.setActionName("Clear Ink")
        replaceDrawing(drawing, resetUndo: false)
        scheduleChange()
    }

    private func apply(_ next: InkSurfaceSettings, webView: WKWebView) {
        let changeTool = !next.sameTool(as: settings)
        let explicitToolRequest = next.toolRequestId != (settings?.toolRequestId ?? 0)
        settings = next
        self.webView = webView
        explicitlyHidden = false
        unitsPerCSS = webView.bounds.width / next.viewportWidth
        if let parent = webView.superview {
            parent.insertSubview(clip, aboveSubview: webView)
            let requested = CGRect(x: next.frame.minX * unitsPerCSS, y: next.frame.minY * unitsPerCSS,
                                   width: next.frame.width * unitsPerCSS, height: next.frame.height * unitsPerCSS)
            let intersection = requested.intersection(webView.bounds)
            let visibleFrame = intersection.isNull ? CGRect(origin: requested.origin, size: .zero) : intersection
        UIView.performWithoutAnimation {
            applyingViewport = true
            defer { applyingViewport = false }
            clip.frame = webView.convert(visibleFrame, to: parent)
                clip.exclusions = next.exclusions.compactMap { css in
                    let native = CGRect(x: css.minX * unitsPerCSS, y: css.minY * unitsPerCSS,
                                        width: css.width * unitsPerCSS, height: css.height * unitsPerCSS)
                    let local = webView.convert(native, to: clip).intersection(clip.bounds)
                    return local.isNull || local.isEmpty ? nil : local
                }
                canvas.frame = clip.bounds
                let zoom = next.scale * unitsPerCSS
                canvas.setZoomScale(zoom, animated: false)
                canvas.contentSize = CGSize(width: inkDocumentSize * zoom, height: inkDocumentSize * zoom)
            let offset = CGPoint(x: visibleFrame.minX - requested.minX - next.pan.x * unitsPerCSS,
                                 y: visibleFrame.minY - requested.minY - next.pan.y * unitsPerCSS)
            viewportZoom = zoom
            viewportOffset = offset
            viewportConfigured = true
                // Permit positive pan and a page smaller than its viewport without
                // UIScrollView clamping the JS transform back to a content edge.
                canvas.contentInset = UIEdgeInsets(
                    top: max(0, -offset.y), left: max(0, -offset.x),
                    bottom: max(0, offset.y + canvas.bounds.height - canvas.contentSize.height),
                    right: max(0, offset.x + canvas.bounds.width - canvas.contentSize.width)
                )
                canvas.setContentOffset(offset, animated: false)
            }
        }
        let matchesNativeTool: Bool
        if next.tool == "eraser" {
            matchesNativeTool = canvas.tool is PKEraserTool
        } else if next.tool == "lasso" {
            matchesNativeTool = canvas.tool is PKLassoTool
        } else if let ink = canvas.tool as? PKInkingTool {
            matchesNativeTool = inkHexColor(ink.color) == next.colorHex && abs(ink.width - next.width) < 0.0001
        } else { matchesNativeTool = false }
        if explicitToolRequest || (changeTool && !matchesNativeTool) {
            // A JS echo of inkSurfaceToolChanged must not turn an object eraser
            // into a pixel eraser, or a native pencil/marker into a ballpoint pen.
            // An incremented toolRequestId is an explicit web toolbar activation:
            // honor its exact tool even when the visible web mode is unchanged.
            let selected: PKTool
            if explicitToolRequest {
                selected = next.nativeTool
            } else if next.tool == "pen", let ink = canvas.tool as? PKInkingTool {
                selected = PKInkingTool(ink.inkType, color: next.color, width: next.width)
            } else { selected = next.nativeTool }
            applyingTool = true
            picker.selectedTool = selected
            synchronizePickerTool()
            applyingTool = false
        }
        refreshPolicyAndVisibility()
    }

    private func configurationResult() -> JSObject {
        ["sessionId": sessionId ?? "", "revision": revision,
         "visible": !clip.isHidden, "inputEnabled": !clip.isHidden && !inputSuspended,
         "fingerDrawing": policy().finger && (settings?.fingerDrawing ?? false),
         "navigationLocked": settings?.navigationLocked ?? false,
         "changedBounds": inkBoundsObject(cached?.revision == revision ? cached?.value.changedBounds : nil)]
    }

    private func refreshPolicyAndVisibility() {
        let permission = policy()
        let visible = permission.enabled && !applicationSuspended && !explicitlyHidden
            && settings?.visible == true && settings?.inputEnabled == true
            && clip.superview != nil && !clip.bounds.isEmpty
        configureInputAndNavigation()
        let drawingEnabled = visible && !inputSuspended
        if canvas.drawingGestureRecognizer.isEnabled != drawingEnabled {
            canvas.drawingGestureRecognizer.isEnabled = drawingEnabled
        }
        let navigation = visible && !inputSuspended && settings?.navigationLocked != true
        if panGesture.isEnabled != navigation { panGesture.isEnabled = navigation }
        if pinchGesture.isEnabled != navigation { pinchGesture.isEnabled = navigation }
        if clip.isHidden == visible { clip.isHidden = !visible }
        if visible && !inputSuspended {
            if !canvas.isFirstResponder { canvas.becomeFirstResponder() }
            picker.setVisible(true, forFirstResponder: canvas)
        } else {
            picker.setVisible(false, forFirstResponder: canvas)
            canvas.resignFirstResponder()
            if !visible {
                setActivity(false)
                DispatchQueue.main.async { [weak self] in self?.runNext() }
            }
        }
        // Becoming first responder or showing the picker can reset recognizers.
        configureInputAndNavigation()
    }

    private func configureInputAndNavigation() {
        let fingerDraws = policy().finger && settings?.fingerDrawing == true
        let drawingPolicy: PKCanvasViewDrawingPolicy = fingerDraws ? .anyInput : .pencilOnly
        if canvas.drawingPolicy != drawingPolicy { canvas.drawingPolicy = drawingPolicy }
        let drawingTouches = fingerDraws
            ? [NSNumber(value: UITouch.TouchType.pencil.rawValue), NSNumber(value: UITouch.TouchType.direct.rawValue)]
            : [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        if canvas.drawingGestureRecognizer.allowedTouchTypes != drawingTouches {
            canvas.drawingGestureRecognizer.allowedTouchTypes = drawingTouches
        }
        let navigationTouches = fingerDraws ? 2 : 1
        if panGesture.minimumNumberOfTouches != navigationTouches {
            panGesture.minimumNumberOfTouches = navigationTouches
        }
        // Only our recognizers may navigate, through inkSurfaceNavigation and
        // the shared JS viewport. Native-only scroll moves ink off its objects.
        if canvas.panGestureRecognizer.isEnabled { canvas.panGestureRecognizer.isEnabled = false }
        if canvas.pinchGestureRecognizer?.isEnabled == true { canvas.pinchGestureRecognizer?.isEnabled = false }
        restoreSharedViewport()
    }

    private func restoreSharedViewport() {
        guard viewportConfigured, !applyingViewport else { return }
        let zoomChanged = abs(canvas.zoomScale - viewportZoom) > 0.000001
        let offsetChanged = abs(canvas.contentOffset.x - viewportOffset.x) > 0.000001
            || abs(canvas.contentOffset.y - viewportOffset.y) > 0.000001
        guard zoomChanged || offsetChanged else { return }
        applyingViewport = true
        defer { applyingViewport = false }
        UIView.performWithoutAnimation {
            if zoomChanged { canvas.setZoomScale(viewportZoom, animated: false) }
            canvas.setContentOffset(viewportOffset, animated: false)
        }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === canvas else { return }
        restoreSharedViewport()
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        guard scrollView === canvas else { return }
        restoreSharedViewport()
    }

    func toolPickerSelectedToolDidChange(_ toolPicker: PKToolPicker) {
        synchronizePickerTool()
    }

    @available(iOS 18.0, *)
    func toolPickerSelectedToolItemDidChange(_ toolPicker: PKToolPicker) {
        synchronizePickerTool()
    }

    private func synchronizePickerTool() {
        let selected = picker.selectedTool
        var value: JSObject = ["sessionId": sessionId ?? "", "revision": revision]
        let signature: String
        if let ink = selected as? PKInkingTool {
            let hex = inkHexColor(ink.color)
            value["tool"] = "pen"
            value["color"] = hex
            value["width"] = Double(ink.width)
            value["nativeInkType"] = ink.inkType.rawValue
            signature = "\(ink.inkType.rawValue):\(hex):\(ink.width)"
        } else if let eraser = selected as? PKEraserTool {
            let kind = eraser.eraserType == .vector ? "object" : "pixel"
            value["tool"] = "eraser"
            value["eraserType"] = kind
            signature = "eraser:\(kind)"
        } else {
            value["tool"] = "lasso"
            signature = "lasso"
        }
        let changed = signature != lastPickerSignature
        if changed { previousNativeTool = canvas.tool }
        canvas.tool = selected
        lastPickerSignature = signature
        configureInputAndNavigation()
        if changed, !applyingTool, sessionId != nil { emit("inkSurfaceToolChanged", value) }
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        guard !clip.isHidden, !inputSuspended else { return }
        switch UIPencilInteraction.preferredTapAction {
        case .switchEraser:
            if canvas.tool is PKEraserTool {
                picker.selectedTool = previousNativeTool is PKEraserTool
                    ? PKInkingTool(.pen, color: settings?.color ?? .black, width: settings?.width ?? 3)
                    : previousNativeTool
            } else { picker.selectedTool = PKEraserTool(.bitmap) }
            synchronizePickerTool()
        case .switchPrevious:
            picker.selectedTool = previousNativeTool
            synchronizePickerTool()
        default: break
        }
    }

    func toolPickerIsRulerActiveDidChange(_ toolPicker: PKToolPicker) {
        canvas.isRulerActive = toolPicker.isRulerActive
    }

    private func observeDrawing() {
        guard !applyingDrawing, sessionId != nil, canvas.drawing != observedDrawing else { return }
        observedDrawing = canvas.drawing
        revision += 1
        cached = nil
        scheduleChange()
    }

    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { observeDrawing() }

    func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
        debounce?.cancel()
        setActivity(true)
    }

    func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
        observeDrawing()
        setActivity(false, completed: canvasView.drawingGestureRecognizer.state != .cancelled)
        scheduleChange()
        // PencilKit can publish the final changed drawing after its end callback.
        DispatchQueue.main.async { [weak self] in self?.runNext() }
    }

    private func setActivity(_ active: Bool, completed: Bool = false) {
        guard usingTool != active else { return }
        usingTool = active
        if active {
            let tool = canvas.tool is PKInkingTool ? "ink" : (canvas.tool is PKEraserTool ? "eraser" : "lasso")
            toolActivity = InkToolActivity(tool: tool, startedAt: ProcessInfo.processInfo.systemUptime,
                                           strokeCountBefore: observedDrawing.strokes.count)
            if let sessionId {
                emit("inkSurfaceActivity", ["sessionId": sessionId, "active": true, "tool": tool])
            }
        } else {
            let activity = toolActivity
            toolActivity = nil
            guard let sessionId, let activity else { return }
            var value: JSObject = [
                "sessionId": sessionId, "active": false, "tool": activity.tool,
                "durationMs": max(0, ProcessInfo.processInfo.systemUptime - activity.startedAt) * 1_000,
                "sampleCount": NSNull(), "sampleCountSource": "PKStrokePath.count", "completed": completed,
            ]
            // This is the final ink path's control-point count, NOT touch-event
            // sampling frequency or frame/render latency. No PNG work is involved.
            // Eraser/lasso, cancellation and not-yet-finalized ink are unmeasured.
            let strokes = canvas.drawing.strokes
            if completed, activity.tool == "ink", strokes.count == activity.strokeCountBefore + 1,
               let lastStroke = strokes.last, lastStroke.path.count > 0 {
                value["sampleCount"] = lastStroke.path.count
            }
            emit("inkSurfaceActivity", value)
        }
    }

    private func snapshotObject(_ encoded: EncodedInk, session: String, revision: Int) -> JSObject {
        var metrics = encoded.metrics
        metrics["canUndo"] = canvas.undoManager?.canUndo ?? false
        metrics["canRedo"] = canvas.undoManager?.canRedo ?? false
        var value: JSObject = [
            "sessionId": session, "revision": revision, "drawingData": encoded.drawingData,
            "previewDataUrl": NSNull(), "bounds": NSNull(), "strokeCount": encoded.strokeCount,
            "metrics": metrics, "changedBounds": inkBoundsObject(encoded.changedBounds),
        ]
        if let preview = encoded.preview { value["previewDataUrl"] = preview }
        if let bounds = encoded.bounds {
            value["bounds"] = ["x": Double(bounds.minX), "y": Double(bounds.minY),
                               "w": Double(bounds.width), "h": Double(bounds.height)] as JSObject
        }
        return value
    }

    private func snapshot(requireCurrent: Bool = false, retry: Int = 0,
                          _ completion: @escaping (Result<JSObject, Error>) -> Void) {
        observeDrawing()
        guard let session = sessionId else {
            completion(.failure(InkSurfaceError(code: "ink_surface_stale_session", message: "No ink session is configured.")))
            return
        }
        let capturedRevision = revision
        let drawing = canvas.drawing
        let preceding = changeBaseline
        if let cached, cached.session == session, cached.revision == capturedRevision {
            completion(.success(snapshotObject(cached.value, session: session, revision: capturedRevision)))
            return
        }
        renderQueue.async { [self] in
            let result = Result { try autoreleasepool { try EncodedInk.make(drawing, previous: preceding) } }
            DispatchQueue.main.async { [self] in
                switch result {
                case .failure(let error): completion(.failure(error))
                case .success(let encoded):
                    observeDrawing()
                    if requireCurrent && (sessionId != session || revision != capturedRevision) {
                        guard retry < 3 else {
                            completion(.failure(InkSurfaceError(code: "ink_surface_busy", message: "Ink continued changing during capture; retry the operation. Ink is retained.")))
                            return
                        }
                        snapshot(requireCurrent: true, retry: retry + 1, completion)
                        return
                    }
                    if sessionId == session && capturedRevision > baselineRevision {
                        changeBaseline = encoded.strokes
                        baselineRevision = capturedRevision
                    }
                    if sessionId == session && revision == capturedRevision {
                        latestValidDrawing = drawing
                        cached = (session, capturedRevision, encoded)
                    }
                    completion(.success(snapshotObject(encoded, session: session, revision: capturedRevision)))
                }
            }
        }
    }

    private func scheduleChange() {
        debounce?.cancel()
        guard let session = sessionId else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.sessionId == session, !self.usingTool else { return }
            if self.operationRunning || self.changeRenderPending {
                self.scheduleChange()
                return
            }
            guard self.revision > self.lastEmittedRevision else { return }
            self.changeRenderPending = true
            let capturedRevision = self.revision
            self.snapshot { [weak self] result in
                guard let self else { return }
                self.changeRenderPending = false
                switch result {
                case .success(let value): self.emitChanged(value)
                case .failure(let error):
                    self.emit("inkSurfaceError", [
                        "sessionId": session, "revision": capturedRevision,
                        "code": (error as? InkSurfaceError)?.code ?? "ink_surface_failed",
                        "message": error.localizedDescription, "recoverable": true,
                    ])
                }
                if self.sessionId == session && self.revision > capturedRevision { self.scheduleChange() }
            }
        }
        debounce = work
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(250), execute: work)
    }

    private func emitChanged(_ value: JSObject) {
        guard let session = value["sessionId"] as? String, let valueRevision = value["revision"] as? Int else { return }
        if session == sessionId {
            guard valueRevision > lastEmittedRevision else { return }
            lastEmittedRevision = valueRevision
        }
        emit("inkSurfaceChanged", value)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        (gestureRecognizer === panGesture && otherGestureRecognizer === pinchGesture)
            || (gestureRecognizer === pinchGesture && otherGestureRecognizer === panGesture)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        !usingTool && !inputSuspended && !clip.isHidden && policy().enabled && settings?.navigationLocked != true
    }

    private func sendNavigation(_ gesture: UIGestureRecognizer, dx: CGFloat, dy: CGFloat, factor: CGFloat) {
        guard let webView, let session = sessionId else { return }
        if gesture.state == .began { gestureSession = session }
        guard gestureSession == session, !clip.isHidden, policy().enabled,
              settings?.navigationLocked != true, !inputSuspended else { return }
        if gesture.state == .began || gesture.state == .changed || gesture.state == .ended {
            let center = gesture.location(in: webView)
            if dx.isFinite, dy.isFinite, factor.isFinite, factor > 0,
               center.x.isFinite, center.y.isFinite,
               dx != 0 || dy != 0 || factor != 1 {
                emit("inkSurfaceNavigation", [
                    "sessionId": session, "dx": Double(dx / unitsPerCSS), "dy": Double(dy / unitsPerCSS),
                    "scaleFactor": Double(factor),
                    "centerX": Double(center.x / unitsPerCSS), "centerY": Double(center.y / unitsPerCSS),
                ])
            }
        }
        if gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                if !self.navigating { self.gestureSession = nil }
                self.runNext()
            }
        }
    }

    @objc private func navigatePan(_ gesture: UIPanGestureRecognizer) {
        let translation = gesture.translation(in: webView)
        gesture.setTranslation(.zero, in: webView)
        sendNavigation(gesture, dx: translation.x, dy: translation.y, factor: 1)
    }

    @objc private func navigatePinch(_ gesture: UIPinchGestureRecognizer) {
        let factor = gesture.scale
        gesture.scale = 1
        sendNavigation(gesture, dx: 0, dy: 0, factor: factor)
    }
}
