import AuthenticationServices
import Capacitor
import CryptoKit
import Foundation
import PencilKit
import Security
import UIKit
import WebKit

private let callbackScheme = "tenet-whiteboard"
private let sessionCookieName = "tenet_mobile_session"
private let keychainAccount = "native-student-session"
private let maximumPencilPngBytes = 6 * 1024 * 1024

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

@objc(TenetNativePlugin)
public final class TenetNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding, UIPencilInteractionDelegate {
    public let identifier = "TenetNativePlugin"
    public let jsName = "TenetNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConfiguration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restoreSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentPencilCanvas", returnType: CAPPluginReturnPromise),
    ]

    private var authenticationSession: ASWebAuthenticationSession?
    private var webCanvasPencilInteraction: UIPencilInteraction?

    public override func load() {
        super.load()
        DispatchQueue.main.async { [weak self] in
            guard let self, UIDevice.current.userInterfaceIdiom == .pad, let webView = self.bridge?.webView else { return }
            let interaction = UIPencilInteraction()
            interaction.delegate = self
            interaction.isEnabled = true
            webView.addInteraction(interaction)
            self.webCanvasPencilInteraction = interaction
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
        let fingerEnabled = raw["fingerDrawingEnabled"] as? Bool ?? false
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
            KeychainStore.delete()
            call.reject(error.localizedDescription, "session_restore_failed", error)
        }
    }

    @objc public func authenticate(_ call: CAPPluginCall) {
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
            call.reject("Pencil studio is disabled by managed configuration.", "pencil_disabled")
            return
        }
        guard let presenter = bridge?.viewController else {
            call.reject("The native presentation context is unavailable.", "presentation_unavailable")
            return
        }

        DispatchQueue.main.async {
            let controller = TenetPencilViewController(
                fingerDrawing: call.getBool("fingerDrawing") ?? config.fingerDrawingEnabled
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
        title = "Pencil studio"
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
