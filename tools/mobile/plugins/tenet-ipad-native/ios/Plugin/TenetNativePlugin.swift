import AuthenticationServices
import Capacitor
import CryptoKit
import Foundation
import ImageIO
import PDFKit
import PencilKit
import Security
import UIKit
import UniformTypeIdentifiers
import WebKit

private let callbackScheme = "tenet-whiteboard"
private let sessionCookieName = "tenet_mobile_session"
private let keychainAccount = "native-student-session"
private let maximumPencilPngBytes = 6 * 1024 * 1024
private let maximumImportedSourceBytes = 40 * 1024 * 1024
private let maximumImportedPageCount = 24
private let maximumImportedPageDimension = 2_400
private let maximumImportedPagePixels = 6_000_000
private let maximumImportedSourceDimension = 32_768
private let maximumImportedSourcePixels = 100_000_000
private let maximumImportedPagePngBytes = 5 * 1024 * 1024
private let maximumImportedTotalPngBytes = 18 * 1024 * 1024
private let maximumExportPngBytes = 16 * 1024 * 1024
private let maximumExportImageDimension = 8_192
private let maximumExportImagePixels = 32_000_000
private let maximumExportPdfBytes = 24 * 1024 * 1024
private let maximumExportPagePoints: CGFloat = 1_440

private func parseInternetDateTime(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

private struct NativeSession: Codable {
    let token: String
    let profile: String
    let baseUrl: String
    let expiresAt: Date
}

private struct ExchangeResponse: Decodable {
    let token: String
    let profile: String
    let expiresAt: String
}

private struct NativeDocumentPage {
    let data: Data
    let width: Int
    let height: Int
    let name: String
}

private enum NativeDocumentError: LocalizedError {
    case unsupportedDocument
    case malformedDocument
    case sourceTooLarge
    case sourceDimensionsTooLarge
    case pageLimitExceeded
    case pageRenderTooLarge
    case totalRenderTooLarge
    case invalidPngDataUrl
    case exportImageTooLarge
    case invalidFilename
    case pdfCreationFailed

    var code: String {
        switch self {
        case .unsupportedDocument: return "document_unsupported"
        case .malformedDocument: return "document_malformed"
        case .sourceTooLarge: return "document_too_large"
        case .sourceDimensionsTooLarge: return "document_dimensions_too_large"
        case .pageLimitExceeded: return "document_page_limit"
        case .pageRenderTooLarge: return "document_page_render_too_large"
        case .totalRenderTooLarge: return "document_render_too_large"
        case .invalidPngDataUrl: return "invalid_png_data_url"
        case .exportImageTooLarge: return "export_image_too_large"
        case .invalidFilename: return "invalid_export_filename"
        case .pdfCreationFailed: return "pdf_creation_failed"
        }
    }

    var errorDescription: String? {
        switch self {
        case .unsupportedDocument:
            return "Choose a PDF or a common image file."
        case .malformedDocument:
            return "The selected document could not be read."
        case .sourceTooLarge:
            return "The selected document exceeds the 40 MiB import limit."
        case .sourceDimensionsTooLarge:
            return "The selected image dimensions are too large to import safely."
        case .pageLimitExceeded:
            return "PDF imports are limited to \(maximumImportedPageCount) pages."
        case .pageRenderTooLarge:
            return "A document page could not be reduced to the safe import size."
        case .totalRenderTooLarge:
            return "The rendered document exceeds the 18 MiB import limit."
        case .invalidPngDataUrl:
            return "Export requires a valid PNG data URL."
        case .exportImageTooLarge:
            return "The PNG exceeds the safe PDF export limits."
        case .invalidFilename:
            return "Provide a short PDF filename without path characters."
        case .pdfCreationFailed:
            return "The PDF could not be created on this iPad."
        }
    }
}

private struct ResolvedConfiguration {
    let valid: Bool
    let managed: Bool
    let profile: String?
    let profileLabel: String
    let baseUrl: String?
    let reason: String?
    let pencilKitEnabled: Bool
    let fingerDrawingEnabled: Bool
}

private enum NativeError: LocalizedError {
    case invalidConfiguration
    case randomFailure
    case invalidCallback
    case exchangeRefused
    case invalidSession
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "The managed student configuration is unavailable or invalid."
        case .randomFailure:
            return "The device could not create secure authentication material."
        case .invalidCallback:
            return "The authentication callback was invalid."
        case .exchangeRefused:
            return "The Tenet authentication service refused the session exchange."
        case .invalidSession:
            return "The stored student session is invalid or expired."
        case .keychain(let status):
            return "The iPad Keychain operation failed with status \(status)."
        }
    }
}

private enum KeychainStore {
    private static var service: String {
        Bundle.main.bundleIdentifier ?? "ai.truemade.tenet.whiteboard"
    }

    static func save(_ data: Data) throws {
        delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw NativeError.keychain(status) }
    }

    static func read() throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw NativeError.keychain(status)
        }
        return data
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

private func randomData(count: Int) throws -> Data {
    var data = Data(count: count)
    let status = data.withUnsafeMutableBytes { bytes in
        guard let address = bytes.baseAddress else { return errSecParam }
        return SecRandomCopyBytes(kSecRandomDefault, count, address)
    }
    guard status == errSecSuccess else { throw NativeError.randomFailure }
    return data
}

private func base64url(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func sha256Base64url(_ value: String) -> String {
    base64url(Data(SHA256.hash(data: Data(value.utf8))))
}

private func isOpaqueCapability(_ value: String) -> Bool {
    value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
}

private func boundedPixelSize(for sourceSize: CGSize) throws -> CGSize {
    guard
        sourceSize.width.isFinite,
        sourceSize.height.isFinite,
        sourceSize.width > 0,
        sourceSize.height > 0
    else {
        throw NativeDocumentError.malformedDocument
    }

    let area = sourceSize.width * sourceSize.height
    guard area.isFinite else { throw NativeDocumentError.malformedDocument }

    var scale = min(
        1,
        CGFloat(maximumImportedPageDimension) / max(sourceSize.width, sourceSize.height)
    )
    if area * scale * scale > CGFloat(maximumImportedPagePixels) {
        scale = min(scale, sqrt(CGFloat(maximumImportedPagePixels) / area))
    }

    return CGSize(
        width: max(1, floor(sourceSize.width * scale)),
        height: max(1, floor(sourceSize.height * scale))
    )
}

private func encodeBoundedPng(_ image: UIImage) throws -> (data: Data, width: Int, height: Int) {
    var size = try boundedPixelSize(for: image.size)

    for _ in 0..<7 {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let rendered = renderer.image { context in
            let bounds = CGRect(origin: .zero, size: size)
            context.cgContext.setFillColor(UIColor.white.cgColor)
            context.cgContext.fill(bounds)
            image.draw(in: bounds)
        }
        guard let data = rendered.pngData() else {
            throw NativeDocumentError.malformedDocument
        }
        if data.count <= maximumImportedPagePngBytes {
            return (data, Int(size.width), Int(size.height))
        }

        let idealScale = sqrt(
            CGFloat(maximumImportedPagePngBytes) / CGFloat(data.count)
        ) * 0.9
        let shrink = min(0.85, max(0.5, idealScale))
        let next = CGSize(
            width: max(1, floor(size.width * shrink)),
            height: max(1, floor(size.height * shrink))
        )
        guard next != size else { break }
        size = next
    }

    throw NativeDocumentError.pageRenderTooLarge
}

private func importedDocumentBaseName(_ url: URL) -> String {
    let raw = url.deletingPathExtension().lastPathComponent
    let withoutControls = raw.components(separatedBy: .controlCharacters).joined()
    let trimmed = withoutControls.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Imported document" : String(trimmed.prefix(80))
}

private func renderImportedImage(_ data: Data, name: String) throws -> NativeDocumentPage {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
        throw NativeDocumentError.malformedDocument
    }
    guard
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
        let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
        width > 0,
        height > 0
    else {
        throw NativeDocumentError.malformedDocument
    }
    let (pixels, overflow) = width.multipliedReportingOverflow(by: height)
    guard
        !overflow,
        width <= maximumImportedSourceDimension,
        height <= maximumImportedSourceDimension,
        pixels <= maximumImportedSourcePixels
    else {
        throw NativeDocumentError.sourceDimensionsTooLarge
    }

    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maximumImportedPageDimension,
        kCGImageSourceShouldCacheImmediately: true,
    ]
    guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
        throw NativeDocumentError.malformedDocument
    }
    let rendered = try encodeBoundedPng(UIImage(cgImage: thumbnail))
    return NativeDocumentPage(
        data: rendered.data,
        width: rendered.width,
        height: rendered.height,
        name: "\(name).png"
    )
}

private func renderImportedDocument(at url: URL) throws -> [NativeDocumentPage] {
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .contentTypeKey])
    guard values.isRegularFile == true else {
        throw NativeDocumentError.malformedDocument
    }

    let handle = try FileHandle(forReadingFrom: url)
    let fileSize: UInt64
    do {
        fileSize = try handle.seekToEnd()
        try handle.close()
    } catch {
        try? handle.close()
        throw error
    }
    guard fileSize > 0 else { throw NativeDocumentError.malformedDocument }
    guard fileSize <= UInt64(maximumImportedSourceBytes) else {
        throw NativeDocumentError.sourceTooLarge
    }

    let extensionType = UTType(filenameExtension: url.pathExtension)
    let isPdf = values.contentType?.conforms(to: .pdf) == true
        || extensionType?.conforms(to: .pdf) == true
    let isImage = values.contentType?.conforms(to: .image) == true
        || extensionType?.conforms(to: .image) == true
    let baseName = importedDocumentBaseName(url)

    if isPdf {
        guard let document = PDFDocument(url: url), !document.isLocked, document.pageCount > 0 else {
            throw NativeDocumentError.malformedDocument
        }
        guard document.pageCount <= maximumImportedPageCount else {
            throw NativeDocumentError.pageLimitExceeded
        }

        var pages: [NativeDocumentPage] = []
        var totalBytes = 0
        pages.reserveCapacity(document.pageCount)
        for index in 0..<document.pageCount {
            let rendered: NativeDocumentPage = try autoreleasepool {
                guard let page = document.page(at: index) else {
                    throw NativeDocumentError.malformedDocument
                }
                let bounds = page.bounds(for: .cropBox)
                let targetSize = try boundedPixelSize(for: CGSize(
                    width: bounds.width * 2,
                    height: bounds.height * 2
                ))
                let thumbnail = page.thumbnail(of: targetSize, for: .cropBox)
                let png = try encodeBoundedPng(thumbnail)
                return NativeDocumentPage(
                    data: png.data,
                    width: png.width,
                    height: png.height,
                    name: "\(baseName) - Page \(index + 1).png"
                )
            }
            let (nextTotal, overflow) = totalBytes.addingReportingOverflow(rendered.data.count)
            guard !overflow, nextTotal <= maximumImportedTotalPngBytes else {
                throw NativeDocumentError.totalRenderTooLarge
            }
            totalBytes = nextTotal
            pages.append(rendered)
        }
        return pages
    }

    if isImage {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count <= maximumImportedSourceBytes else {
            throw NativeDocumentError.sourceTooLarge
        }
        let page = try renderImportedImage(data, name: baseName)
        guard page.data.count <= maximumImportedTotalPngBytes else {
            throw NativeDocumentError.totalRenderTooLarge
        }
        return [page]
    }

    throw NativeDocumentError.unsupportedDocument
}

private func normalizedPdfFilename(_ raw: String) throws -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
        !trimmed.isEmpty,
        trimmed.count <= 120,
        trimmed.rangeOfCharacter(from: CharacterSet(charactersIn: "/\\:")) == nil,
        trimmed.rangeOfCharacter(from: .controlCharacters) == nil
    else {
        throw NativeDocumentError.invalidFilename
    }

    var stem = trimmed
    if stem.lowercased().hasSuffix(".pdf") {
        stem.removeLast(4)
        stem = stem.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    guard !stem.isEmpty, stem != ".", stem != ".." else {
        throw NativeDocumentError.invalidFilename
    }
    return "\(stem).pdf"
}

private func decodeExportPng(_ dataUrl: String) throws -> (image: UIImage, width: Int, height: Int) {
    let prefix = "data:image/png;base64,"
    guard dataUrl.hasPrefix(prefix) else {
        throw NativeDocumentError.invalidPngDataUrl
    }
    let payload = dataUrl.dropFirst(prefix.count)
    let maximumEncodedLength = ((maximumExportPngBytes + 2) / 3) * 4
    guard !payload.isEmpty, payload.utf8.count <= maximumEncodedLength else {
        throw NativeDocumentError.exportImageTooLarge
    }
    guard
        let data = Data(base64Encoded: String(payload)),
        !data.isEmpty,
        data.count <= maximumExportPngBytes
    else {
        throw NativeDocumentError.invalidPngDataUrl
    }

    let header = [UInt8](data.prefix(24))
    guard
        header.count == 24,
        header[0] == 0x89,
        header[1] == 0x50,
        header[2] == 0x4E,
        header[3] == 0x47,
        header[4] == 0x0D,
        header[5] == 0x0A,
        header[6] == 0x1A,
        header[7] == 0x0A,
        header[12] == 0x49,
        header[13] == 0x48,
        header[14] == 0x44,
        header[15] == 0x52
    else {
        throw NativeDocumentError.invalidPngDataUrl
    }

    let width = (Int(header[16]) << 24)
        | (Int(header[17]) << 16)
        | (Int(header[18]) << 8)
        | Int(header[19])
    let height = (Int(header[20]) << 24)
        | (Int(header[21]) << 16)
        | (Int(header[22]) << 8)
        | Int(header[23])
    let (pixels, overflow) = width.multipliedReportingOverflow(by: height)
    guard
        width > 0,
        height > 0,
        !overflow,
        width <= maximumExportImageDimension,
        height <= maximumExportImageDimension,
        pixels <= maximumExportImagePixels
    else {
        throw NativeDocumentError.exportImageTooLarge
    }
    guard let image = UIImage(data: data, scale: 1), image.cgImage != nil else {
        throw NativeDocumentError.invalidPngDataUrl
    }
    return (image, width, height)
}

private func createExportPdf(dataUrl: String, filename: String) throws -> (url: URL, filename: String) {
    let decoded = try decodeExportPng(dataUrl)
    let safeFilename = try normalizedPdfFilename(filename)
    let longestSide = CGFloat(max(decoded.width, decoded.height))
    let pageScale = min(1, maximumExportPagePoints / longestSide)
    let pageSize = CGSize(
        width: max(1, CGFloat(decoded.width) * pageScale),
        height: max(1, CGFloat(decoded.height) * pageScale)
    )
    let pageBounds = CGRect(origin: .zero, size: pageSize)
    let renderer = UIGraphicsPDFRenderer(bounds: pageBounds)
    let pdfData = renderer.pdfData { context in
        context.beginPage()
        context.cgContext.setFillColor(UIColor.white.cgColor)
        context.cgContext.fill(pageBounds)
        decoded.image.draw(in: pageBounds)
    }
    guard !pdfData.isEmpty, pdfData.count <= maximumExportPdfBytes else {
        throw NativeDocumentError.pdfCreationFailed
    }

    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("tenet-pdf-\(UUID().uuidString)", isDirectory: true)
    do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(safeFilename, isDirectory: false)
        try pdfData.write(to: url, options: .atomic)
        return (url, safeFilename)
    } catch {
        try? FileManager.default.removeItem(at: directory)
        throw NativeDocumentError.pdfCreationFailed
    }
}

private func removeTemporaryExport(_ url: URL) {
    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
}

@objc(TenetNativePlugin)
public final class TenetNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding, UIPencilInteractionDelegate, UIDocumentPickerDelegate {
    public let identifier = "TenetNativePlugin"
    public let jsName = "TenetNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConfiguration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentPencilCanvas", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureInkSurface", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flushInkSurface", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideInkSurface", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inkSurfaceCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportPdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVoiceCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startVoiceRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopVoiceRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelVoiceRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speakVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise),
    ]

    private var authenticationSession: ASWebAuthenticationSession?
    private var webCanvasPencilInteraction: UIPencilInteraction?
    private var documentPickerCall: CAPPluginCall?
    private var documentPickerController: UIDocumentPickerViewController?
    private var exportCall: CAPPluginCall?
    private var exportTemporaryUrl: URL?
    private var voiceSession: TenetVoiceSession?
    private var voiceLoadingObservation: NSKeyValueObservation?
    private var voiceUrlObservation: NSKeyValueObservation?

    // The web page owns persistence. This controller owns only the live native drawing.
    private lazy var inkSurface = TenetInkSurface(
        policy: { [weak self] in
            guard let self else { return (enabled: false, finger: false) }
            let config = self.configuration()
            return (enabled: config.valid && config.pencilKitEnabled, finger: config.fingerDrawingEnabled)
        },
        emit: { [weak self] event, data in
            self?.notifyListeners(event, data: data)
        }
    )

    public override func load() {
        super.load()
        DispatchQueue.main.async { [weak self] in
            guard let self, UIDevice.current.userInterfaceIdiom == .pad, let webView = self.bridge?.webView else { return }
            let interaction = UIPencilInteraction()
            interaction.delegate = self
            interaction.isEnabled = true
            webView.addInteraction(interaction)
            self.webCanvasPencilInteraction = interaction
            // Do not replace WKNavigationDelegate: Capacitor owns navigation.
            self.voiceLoadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] _, change in
                if change.newValue == true { self?.stopNativeVoice() }
            }
            self.voiceUrlObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
                self?.stopNativeVoice()
            }
        }
    }

    deinit {
        voiceLoadingObservation?.invalidate()
        voiceUrlObservation?.invalidate()
        voiceSession?.shutdown()
    }

    private func stopNativeVoice() {
        DispatchQueue.main.async { [weak self] in
            self?.voiceSession?.cancelAll()
        }
    }

    // The Keychain capability, configured district and current page must agree.
    // Never authorize voice using a client-side authenticated flag.
    private func voiceAuthority() -> String? {
        let config = configuration()
        guard
            UIDevice.current.userInterfaceIdiom == .pad,
            config.valid,
            let profile = config.profile,
            let baseUrl = config.baseUrl,
            let expected = URL(string: baseUrl),
            let actual = bridge?.webView?.url,
            actual.scheme == "https",
            actual.host == expected.host,
            (actual.port ?? 443) == (expected.port ?? 443),
            actual.user == nil,
            actual.password == nil,
            let data = try? KeychainStore.read(),
            let session = try? JSONDecoder().decode(NativeSession.self, from: data),
            session.expiresAt > Date().addingTimeInterval(30),
            session.profile == profile,
            session.baseUrl == baseUrl,
            isOpaqueCapability(session.token)
        else { return nil }
        return session.token
    }

    private func nativeVoice() -> TenetVoiceSession {
        if let voiceSession { return voiceSession }
        let session = TenetVoiceSession(
            authority: { [weak self] in self?.voiceAuthority() },
            emit: { [weak self] event, data in self?.notifyListeners(event, data: data) }
        )
        voiceSession = session
        return session
    }

    @objc public func getVoiceCapabilities(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.nativeVoice().capabilities(locale: call.getString("locale")))
        }
    }

    @objc public func startVoiceRecognition(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.nativeVoice().start(call) }
    }

    @objc public func stopVoiceRecognition(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.nativeVoice().stop(call) }
    }

    @objc public func cancelVoiceRecognition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.voiceSession?.cancelRecognition(sessionId: call.getString("sessionId"))
            call.resolve()
        }
    }

    @objc public func speakVoice(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.nativeVoice().speak(call) }
    }

    @objc public func stopSpeaking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.voiceSession?.stopSpeaking()
            call.resolve()
        }
    }

    public func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        switch UIPencilInteraction.preferredTapAction {
        case .switchEraser:
            notifyListeners("pencilToolAction", data: ["action": "switchEraser"])
        case .switchPrevious:
            notifyListeners("pencilToolAction", data: ["action": "switchPrevious"])
        default:
            break
        }
    }

    private let profiles: [String: (label: String, baseUrl: String)] = [
        "district": ("District student rules", "https://district.connect.truemadeai.com"),
        "spanish": ("Spanish immersion student rules", "https://spanish.connect.truemadeai.com"),
    ]

    private func configuration() -> ResolvedConfiguration {
        let raw = UserDefaults.standard.dictionary(forKey: "com.apple.configuration.managed") ?? [:]
        let managed = !raw.isEmpty
        let requiresManaged = raw["requireManagedConfiguration"] as? Bool ?? false
        let pencilEnabled = raw["pencilKitEnabled"] as? Bool ?? true
        // Allow fingers and capacitive styli without requiring MDM enrollment.
        // An explicit false or malformed managed value still disables touch ink.
        let fingerEnabled = raw["fingerDrawingEnabled"].map { $0 as? Bool ?? false } ?? true
        var profile = raw["studentRuleProfile"] as? String
        if profile == nil && !requiresManaged { profile = "district" }

        guard let selected = profile, let record = profiles[selected] else {
            return ResolvedConfiguration(
                valid: false,
                managed: managed,
                profile: nil,
                profileLabel: "Unavailable",
                baseUrl: nil,
                reason: requiresManaged
                    ? "Your district must install a Tenet Whiteboard managed app configuration."
                    : "The managed studentRuleProfile is not recognized.",
                pencilKitEnabled: pencilEnabled,
                fingerDrawingEnabled: fingerEnabled
            )
        }

        return ResolvedConfiguration(
            valid: true,
            managed: managed,
            profile: selected,
            profileLabel: record.label,
            baseUrl: record.baseUrl,
            reason: nil,
            pencilKitEnabled: pencilEnabled,
            fingerDrawingEnabled: fingerEnabled
        )
    }

    @objc public func getConfiguration(_ call: CAPPluginCall) {
        let config = configuration()
        var result: JSObject = [
            "valid": config.valid,
            "managed": config.managed,
            "profileLabel": config.profileLabel,
            "pencilKitEnabled": config.pencilKitEnabled,
            "fingerDrawingEnabled": config.fingerDrawingEnabled,
        ]
        if let profile = config.profile { result["profile"] = profile }
        if let baseUrl = config.baseUrl { result["baseUrl"] = baseUrl }
        if let reason = config.reason { result["reason"] = reason }
        call.resolve(result)
    }

    @objc public func restoreSession(_ call: CAPPluginCall) {
        do {
            let config = configuration()
            guard config.valid, let profile = config.profile, let baseUrl = config.baseUrl else {
                throw NativeError.invalidConfiguration
            }
            guard let data = try KeychainStore.read() else {
                call.resolve(["authenticated": false])
                return
            }
            let session = try JSONDecoder().decode(NativeSession.self, from: data)
            guard
                session.expiresAt > Date().addingTimeInterval(30),
                session.profile == profile,
                session.baseUrl == baseUrl,
                isOpaqueCapability(session.token)
            else {
                stopNativeVoice()
                KeychainStore.delete()
                call.resolve(["authenticated": false])
                return
            }
            setSessionCookie(session) { result in
                DispatchQueue.main.async {
                    switch result {
                    case .success:
                        call.resolve([
                            "authenticated": true,
                            "profile": session.profile,
                            "expiresAt": ISO8601DateFormatter().string(from: session.expiresAt),
                        ])
                    case .failure(let error):
                        call.reject(error.localizedDescription, "cookie_restore_failed", error)
                    }
                }
            }
        } catch {
            stopNativeVoice()
            KeychainStore.delete()
            call.reject(error.localizedDescription, "session_restore_failed", error)
        }
    }

    @objc public func authenticate(_ call: CAPPluginCall) {
        stopNativeVoice()
        guard authenticationSession == nil else {
            call.reject("A sign-in session is already active.", "auth_in_progress")
            return
        }
        let config = configuration()
        guard
            config.valid,
            let profile = config.profile,
            let expectedBaseUrl = config.baseUrl,
            let requestedBaseUrl = call.getString("baseUrl"),
            requestedBaseUrl == expectedBaseUrl,
            let baseUrl = URL(string: expectedBaseUrl)
        else {
            call.reject(NativeError.invalidConfiguration.localizedDescription, "invalid_configuration")
            return
        }

        do {
            let verifier = base64url(try randomData(count: 32))
            let challenge = sha256Base64url(verifier)
            let state = base64url(try randomData(count: 24))
            var components = URLComponents(
                url: baseUrl.appendingPathComponent("mobile-auth/native/start"),
                resolvingAgainstBaseURL: false
            )
            components?.queryItems = [
                URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "code_challenge", value: challenge),
            ]
            guard let startUrl = components?.url else { throw NativeError.invalidConfiguration }

            let session = ASWebAuthenticationSession(
                url: startUrl,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackUrl, error in
                guard let self else { return }
                self.authenticationSession = nil
                if let error {
                    call.reject(error.localizedDescription, "auth_cancelled", error)
                    return
                }
                guard
                    let callbackUrl,
                    callbackUrl.scheme == callbackScheme,
                    let callback = URLComponents(url: callbackUrl, resolvingAgainstBaseURL: false),
                    callback.queryItems?.first(where: { $0.name == "state" })?.value == state,
                    let code = callback.queryItems?.first(where: { $0.name == "code" })?.value,
                    isOpaqueCapability(code)
                else {
                    call.reject(NativeError.invalidCallback.localizedDescription, "invalid_callback")
                    return
                }
                self.exchange(
                    code: code,
                    verifier: verifier,
                    profile: profile,
                    baseUrl: baseUrl,
                    call: call
                )
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            authenticationSession = session
            guard session.start() else {
                authenticationSession = nil
                call.reject("The system authentication session could not start.", "auth_start_failed")
                return
            }
        } catch {
            call.reject(error.localizedDescription, "auth_setup_failed", error)
        }
    }

    private func exchange(
        code: String,
        verifier: String,
        profile: String,
        baseUrl: URL,
        call: CAPPluginCall
    ) {
        let exchangeUrl = baseUrl.appendingPathComponent("mobile-auth/native/exchange")
        var request = URLRequest(url: exchangeUrl)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "code": code,
            "codeVerifier": verifier,
        ])

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        URLSession(configuration: configuration).dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            do {
                if let error { throw error }
                guard
                    let response = response as? HTTPURLResponse,
                    response.statusCode == 200,
                    let data,
                    let decoded = try? JSONDecoder().decode(ExchangeResponse.self, from: data),
                    decoded.profile == profile,
                    isOpaqueCapability(decoded.token),
                    let expiresAt = parseInternetDateTime(decoded.expiresAt),
                    expiresAt > Date()
                else {
                    throw NativeError.exchangeRefused
                }

                let session = NativeSession(
                    token: decoded.token,
                    profile: decoded.profile,
                    baseUrl: baseUrl.absoluteString,
                    expiresAt: expiresAt
                )
                try KeychainStore.save(JSONEncoder().encode(session))
                self.setSessionCookie(session) { result in
                    DispatchQueue.main.async {
                        switch result {
                        case .success:
                            call.resolve([
                                "authenticated": true,
                                "profile": session.profile,
                                "expiresAt": decoded.expiresAt,
                            ])
                        case .failure(let error):
                            KeychainStore.delete()
                            call.reject(error.localizedDescription, "cookie_install_failed", error)
                        }
                    }
                }
            } catch {
                KeychainStore.delete()
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription, "auth_exchange_failed", error)
                }
            }
        }.resume()
    }

    private func setSessionCookie(_ session: NativeSession, completion: @escaping (Result<Void, Error>) -> Void) {
        guard
            let url = URL(string: session.baseUrl),
            let host = url.host,
            let webView = bridge?.webView
        else {
            completion(.failure(NativeError.invalidSession))
            return
        }
        let properties: [HTTPCookiePropertyKey: Any] = [
            .name: sessionCookieName,
            .value: session.token,
            .domain: host,
            .path: "/",
            .secure: "TRUE",
            .expires: session.expiresAt,
            HTTPCookiePropertyKey("HttpOnly"): "TRUE",
            HTTPCookiePropertyKey("SameSite"): "Lax",
        ]
        guard let cookie = HTTPCookie(properties: properties) else {
            completion(.failure(NativeError.invalidSession))
            return
        }
        DispatchQueue.main.async {
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
                completion(.success(()))
            }
        }
    }

    @objc public func signOut(_ call: CAPPluginCall) {
        stopNativeVoice()
        let stored: NativeSession?
        do {
            if let data = try KeychainStore.read() {
                stored = try? JSONDecoder().decode(NativeSession.self, from: data)
            } else {
                stored = nil
            }
        } catch {
            stored = nil
        }
        KeychainStore.delete()
        if let stored { revoke(stored) }

        guard let cookieStore = bridge?.webView?.configuration.websiteDataStore.httpCookieStore else {
            call.resolve(["signedOut": true])
            return
        }
        cookieStore.getAllCookies { cookies in
            let matches = cookies.filter { $0.name == sessionCookieName }
            let group = DispatchGroup()
            for cookie in matches {
                group.enter()
                cookieStore.delete(cookie) { group.leave() }
            }
            group.notify(queue: .main) {
                call.resolve(["signedOut": true])
            }
        }
    }

    private func revoke(_ session: NativeSession) {
        guard let baseUrl = URL(string: session.baseUrl) else { return }
        var request = URLRequest(url: baseUrl.appendingPathComponent("mobile-auth/native/revoke"))
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        URLSession(configuration: .ephemeral).dataTask(with: request).resume()
    }

    @objc public func presentPencilCanvas(_ call: CAPPluginCall) {
        let config = configuration()
        guard config.valid, config.pencilKitEnabled else {
            call.reject("Apple Pencil sketch is disabled by managed configuration.", "pencil_disabled")
            return
        }
        guard let presenter = bridge?.viewController else {
            call.reject("The native presentation context is unavailable.", "presentation_unavailable")
            return
        }

        DispatchQueue.main.async {
            let controller = TenetPencilViewController(
                fingerDrawing: config.fingerDrawingEnabled && (call.getBool("fingerDrawing") ?? true)
            )
            let navigation = UINavigationController(rootViewController: controller)
            navigation.modalPresentationStyle = .fullScreen
            controller.onComplete = { result in
                navigation.dismiss(animated: true) {
                    guard let result else {
                        call.resolve(["cancelled": true])
                        return
                    }
                    call.resolve([
                        "cancelled": false,
                        "dataUrl": "data:image/png;base64,\(result.data.base64EncodedString())",
                        "width": result.width,
                        "height": result.height,
                    ])
                }
            }
            presenter.present(navigation, animated: true)
        }
    }

    @objc public func configureInkSurface(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("The native web view is unavailable.", "ink_surface_unavailable")
                return
            }
            self.inkSurface.configure(call, above: webView)
        }
    }

    @objc public func flushInkSurface(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.inkSurface.flush(call, hide: false) }
    }

    @objc public func hideInkSurface(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.inkSurface.flush(call, hide: true) }
    }

    @objc public func inkSurfaceCommand(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.inkSurface.command(call) }
    }

    @objc public func pickDocument(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.documentPickerCall == nil else {
                call.reject("A document picker is already active.", "document_picker_busy")
                return
            }
            guard
                let presenter = self.bridge?.viewController,
                presenter.viewIfLoaded?.window != nil,
                presenter.presentedViewController == nil
            else {
                call.reject("The native presentation context is unavailable.", "presentation_unavailable")
                return
            }

            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [UTType.pdf, UTType.image],
                asCopy: true
            )
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.documentPickerCall = call
            self.documentPickerController = picker
            presenter.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard controller === documentPickerController, let call = documentPickerCall else { return }
        documentPickerCall = nil
        documentPickerController = nil
        call.resolve([
            "cancelled": true,
            "pages": JSArray(),
        ])
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard controller === documentPickerController, let call = documentPickerCall else { return }
        documentPickerController = nil
        guard urls.count == 1, let url = urls.first else {
            documentPickerCall = nil
            call.reject("Choose exactly one document.", "document_selection_invalid")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let accessed = url.startAccessingSecurityScopedResource()
            defer {
                if accessed { url.stopAccessingSecurityScopedResource() }
            }

            do {
                let pages = try renderImportedDocument(at: url)
                let pageObjects: JSArray = pages.map { page in
                    [
                        "dataUrl": "data:image/png;base64,\(page.data.base64EncodedString())",
                        "width": page.width,
                        "height": page.height,
                        "name": page.name,
                    ] as JSObject
                }
                DispatchQueue.main.async {
                    self.documentPickerCall = nil
                    call.resolve([
                        "cancelled": false,
                        "pages": pageObjects,
                    ])
                }
            } catch {
                DispatchQueue.main.async {
                    self.documentPickerCall = nil
                    let code = (error as? NativeDocumentError)?.code ?? "document_read_failed"
                    call.reject(error.localizedDescription, code, error)
                }
            }
        }
    }

    @objc public func exportPdf(_ call: CAPPluginCall) {
        guard
            let dataUrl = call.getString("dataUrl"),
            let filename = call.getString("filename")
        else {
            call.reject(
                NativeDocumentError.invalidPngDataUrl.localizedDescription,
                NativeDocumentError.invalidPngDataUrl.code
            )
            return
        }

        DispatchQueue.main.async {
            guard self.exportCall == nil else {
                call.reject("A PDF export is already active.", "export_busy")
                return
            }
            guard
                let presenter = self.bridge?.viewController,
                presenter.viewIfLoaded?.window != nil,
                presenter.presentedViewController == nil
            else {
                call.reject("The native presentation context is unavailable.", "presentation_unavailable")
                return
            }

            self.exportCall = call
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let export = try createExportPdf(dataUrl: dataUrl, filename: filename)
                    DispatchQueue.main.async {
                        guard
                            self.exportCall != nil,
                            presenter.presentedViewController == nil
                        else {
                            self.exportCall = nil
                            removeTemporaryExport(export.url)
                            call.reject("Another screen is currently open.", "presentation_busy")
                            return
                        }

                        self.exportTemporaryUrl = export.url
                        let activity = UIActivityViewController(
                            activityItems: [export.url],
                            applicationActivities: nil
                        )
                        if let popover = activity.popoverPresentationController {
                            popover.sourceView = presenter.view
                            popover.sourceRect = CGRect(
                                x: presenter.view.bounds.midX,
                                y: presenter.view.bounds.midY,
                                width: 1,
                                height: 1
                            )
                            popover.permittedArrowDirections = []
                        }
                        activity.completionWithItemsHandler = { [weak self] _, completed, _, error in
                            DispatchQueue.main.async {
                                removeTemporaryExport(export.url)
                                guard let self else { return }
                                self.exportCall = nil
                                self.exportTemporaryUrl = nil
                                if let error {
                                    call.reject(error.localizedDescription, "share_failed", error)
                                } else {
                                    call.resolve([
                                        "cancelled": !completed,
                                        "filename": export.filename,
                                    ])
                                }
                            }
                        }
                        presenter.present(activity, animated: true)
                    }
                } catch {
                    DispatchQueue.main.async {
                        self.exportCall = nil
                        self.exportTemporaryUrl = nil
                        let code = (error as? NativeDocumentError)?.code ?? "pdf_creation_failed"
                        call.reject(error.localizedDescription, code, error)
                    }
                }
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}

private final class TenetPencilViewController: UIViewController {
    struct Result {
        let data: Data
        let width: Int
        let height: Int
    }

    var onComplete: ((Result?) -> Void)?
    private let canvasView = PKCanvasView()
    private let toolPicker = PKToolPicker()
    private let fingerDrawing: Bool

    init(fingerDrawing: Bool) {
        self.fingerDrawing = fingerDrawing
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 246 / 255, green: 242 / 255, blue: 232 / 255, alpha: 1)
        title = "Apple Pencil sketch"
        navigationItem.prompt = "Tap Done to place this sketch on the current page."
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(cancel)
        )
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(done)),
            UIBarButtonItem(title: "Clear", style: .plain, target: self, action: #selector(clear)),
        ]

        canvasView.translatesAutoresizingMaskIntoConstraints = false
        canvasView.backgroundColor = .white
        canvasView.drawingPolicy = fingerDrawing ? .anyInput : .pencilOnly
        canvasView.tool = PKInkingTool(.pen, color: UIColor(red: 20 / 255, green: 36 / 255, blue: 59 / 255, alpha: 1), width: 4)
        canvasView.alwaysBounceVertical = true
        canvasView.alwaysBounceHorizontal = true
        view.addSubview(canvasView)
        NSLayoutConstraint.activate([
            canvasView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            canvasView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            canvasView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            canvasView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        toolPicker.addObserver(canvasView)
        toolPicker.setVisible(true, forFirstResponder: canvasView)
        canvasView.becomeFirstResponder()
    }

    @objc private func cancel() {
        canvasView.drawing = PKDrawing()
        onComplete?(nil)
    }

    @objc private func clear() {
        canvasView.drawing = PKDrawing()
    }

    @objc private func done() {
        let drawing = canvasView.drawing
        guard !drawing.strokes.isEmpty else {
            showAlert(title: "Nothing to add", message: "Draw something with Apple Pencil first.")
            return
        }
        let bounds = drawing.bounds.insetBy(dx: -24, dy: -24)
        let image = drawing.image(from: bounds, scale: 1)
        guard let data = image.pngData(), data.count <= maximumPencilPngBytes else {
            showAlert(title: "Drawing is too large", message: "Clear part of the page and try again.")
            return
        }
        canvasView.drawing = PKDrawing()
        onComplete?(Result(
            data: data,
            width: max(1, Int(bounds.width.rounded(.up))),
            height: max(1, Int(bounds.height.rounded(.up)))
        ))
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
