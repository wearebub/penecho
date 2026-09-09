// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TenetIpadNative",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "TenetIpadNative", targets: ["TenetIpadNative"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "TenetIpadNative",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Plugin",
            resources: [.copy("PrivacyInfo.xcprivacy")]
        )
    ]
)
