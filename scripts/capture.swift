// Screen capture for scripts/screenshots.js on macOS: the main display with every ordinary app window left out except
// StickyDrop's, so a terminal or anything else in use while it runs never appears. The wallpaper, desktop and menu bar
// stay.
// Built by the script with swiftc (-parse-as-library), then:
//   capture still <out.png>
//   capture video <seconds> <out.mov>   (prints "recording" once frames are being written)
// Needs Screen Recording permission for the terminal (System Settings → Privacy & Security). macOS 15+.
import Foundation
import ScreenCaptureKit
import AppKit

final class Done: NSObject, SCRecordingOutputDelegate {}

@main
struct Capture {
  static func main() async throws {
    let args = CommandLine.arguments
    guard args.count >= 3 else { print("usage: capture still <out.png> | capture video <seconds> <out.mov>"); exit(2) }
    let keep: Set<String> = ["com.github.Electron", "com.stickydrop.app"] // run from source, or the built app

    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { exit(1) }
    // leave out every ordinary window (layer 0) that isn't ours
    let others = content.windows.filter { $0.windowLayer == 0 && !keep.contains($0.owningApplication?.bundleIdentifier ?? "") }
    let filter = SCContentFilter(display: display, excludingWindows: others)

    let config = SCStreamConfiguration()
    let scale = Int(NSScreen.main?.backingScaleFactor ?? 2)
    config.width = display.width * scale
    config.height = display.height * scale
    config.showsCursor = false
    config.capturesAudio = false

    if args[1] == "still" {
      let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
      let rep = NSBitmapImageRep(cgImage: image)
      try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
    } else if args[1] == "video", args.count >= 4, let seconds = Double(args[2]) {
      config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
      let stream = SCStream(filter: filter, configuration: config, delegate: nil)
      let out = SCRecordingOutputConfiguration()
      out.outputURL = URL(fileURLWithPath: args[3])
      out.outputFileType = .mov
      let done = Done() // held here: the output keeps only a weak reference to its delegate
      let recording = SCRecordingOutput(configuration: out, delegate: done)
      try stream.addRecordingOutput(recording)
      try await stream.startCapture()
      print("recording") // the caller waits for this line before starting the animation
      fflush(stdout)
      try await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
      try await stream.stopCapture()
      try await Task.sleep(nanoseconds: 500_000_000) // let the file finish writing
      withExtendedLifetime(done) {}
    } else {
      exit(2)
    }
  }
}
