Pod::Spec.new do |s|
  s.name = 'TruemadeTenetIpadNative'
  s.version = '0.1.0'
  s.summary = 'First-party native iPad bridge for Tenet Whiteboard.'
  s.license = { :type => 'Proprietary', :text => 'Copyright TrueMadeAI' }
  s.homepage = 'https://truemadeai.com'
  s.author = { 'TrueMadeAI' => 'engineering@truemadeai.com' }
  s.source = { :git => 'https://github.com/wearebub/tenet.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift}'
  s.resource_bundles = {
    'TruemadeTenetIpadNativePrivacy' => ['ios/Plugin/PrivacyInfo.xcprivacy']
  }
  s.ios.deployment_target = '14.0'
  s.swift_version = '5.9'
  s.dependency 'Capacitor'
  s.frameworks = 'AuthenticationServices', 'AVFoundation', 'CryptoKit', 'PencilKit', 'Security', 'Speech', 'UIKit', 'WebKit'
end
