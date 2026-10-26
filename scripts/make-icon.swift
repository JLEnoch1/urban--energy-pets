// 生成应用图标:build/icon.png (1024) + build/icon.icns
// 用法: swift scripts/make-icon.swift build
import AppKit
import Foundation

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build"
let fm = FileManager.default
try? fm.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let ink = NSColor(srgbRed: 0.169, green: 0.129, blue: 0.094, alpha: 1)
let cream = NSColor(srgbRed: 1.0, green: 0.969, blue: 0.918, alpha: 1)

func mkRep(_ size: Int) -> NSBitmapImageRep? {
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
  ) else { return nil }
  rep.size = NSSize(width: size, height: size)
  return rep
}

func tri(_ a: NSPoint, _ b: NSPoint, _ c: NSPoint) -> NSBezierPath {
  let p = NSBezierPath()
  p.move(to: a); p.line(to: b); p.line(to: c); p.close()
  return p
}

func stroke(_ p: NSBezierPath, _ w: CGFloat) {
  p.lineWidth = w
  p.lineJoinStyle = .round
  p.lineCapStyle = .round
  ink.setStroke()
  p.stroke()
}

guard let rep = mkRep(1024) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high

// 圆角底板 + 暖色渐变
let board = NSBezierPath(roundedRect: NSRect(x: 72, y: 72, width: 880, height: 880), xRadius: 205, yRadius: 205)
NSGradient(
  starting: NSColor(srgbRed: 1.0, green: 0.878, blue: 0.686, alpha: 1),
  ending: NSColor(srgbRed: 1.0, green: 0.706, blue: 0.443, alpha: 1)
)?.draw(in: board, angle: -70)

// 猫耳朵(先画,再被头部覆盖底部)
let lw: CGFloat = 30
for path in [tri(NSPoint(x: 288, y: 588), NSPoint(x: 312, y: 826), NSPoint(x: 486, y: 700)),
             tri(NSPoint(x: 736, y: 588), NSPoint(x: 712, y: 826), NSPoint(x: 538, y: 700))] {
  cream.setFill(); path.fill(); stroke(path, lw)
}

// 头部
let head = NSBezierPath(ovalIn: NSRect(x: 245, y: 195, width: 534, height: 480))
cream.setFill(); head.fill(); stroke(head, lw)

// 眼睛
for cx in [416.0, 608.0] {
  let eye = NSBezierPath(ovalIn: NSRect(x: cx - 31, y: 408, width: 62, height: 74))
  ink.setFill(); eye.fill()
}

// 鼻子 + 嘴
let nose = tri(NSPoint(x: 476, y: 352), NSPoint(x: 548, y: 352), NSPoint(x: 512, y: 306))
NSColor(srgbRed: 0.949, green: 0.502, blue: 0.494, alpha: 1).setFill()
nose.fill(); stroke(nose, 14)

let mouth = NSBezierPath()
mouth.move(to: NSPoint(x: 512, y: 306))
mouth.curve(to: NSPoint(x: 470, y: 268), controlPoint1: NSPoint(x: 512, y: 278), controlPoint2: NSPoint(x: 492, y: 262))
mouth.move(to: NSPoint(x: 512, y: 306))
mouth.curve(to: NSPoint(x: 554, y: 268), controlPoint1: NSPoint(x: 512, y: 278), controlPoint2: NSPoint(x: 532, y: 262))
stroke(mouth, 16)

// 胡须
let whisk = NSBezierPath()
for dy in [CGFloat(20), CGFloat(-24)] {
  whisk.move(to: NSPoint(x: 262, y: 380 + dy)); whisk.line(to: NSPoint(x: 336, y: 388 + dy))
  whisk.move(to: NSPoint(x: 762, y: 380 + dy)); whisk.line(to: NSPoint(x: 688, y: 388 + dy))
}
stroke(whisk, 15)

// 腮红
NSColor(srgbRed: 1.0, green: 0.62, blue: 0.557, alpha: 0.55).setFill()
for cx in [340.0, 684.0] {
  NSBezierPath(ovalIn: NSRect(x: cx - 48, y: 300, width: 96, height: 58)).fill()
}

NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: "\(outDir)/icon.png"))
print("wrote \(outDir)/icon.png")

// iconset + icns
let iconset = "\(outDir)/icon.iconset"
try? fm.removeItem(atPath: iconset)
try fm.createDirectory(atPath: iconset, withIntermediateDirectories: true)

let source = NSImage(size: NSSize(width: 1024, height: 1024))
source.addRepresentation(rep)

func writeSize(_ px: Int, _ name: String) {
  guard let out = mkRep(px) else { return }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: out)
  NSGraphicsContext.current?.imageInterpolation = .high
  source.draw(in: NSRect(x: 0, y: 0, width: px, height: px),
              from: NSRect(x: 0, y: 0, width: 1024, height: 1024),
              operation: .copy, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  if let d = out.representation(using: .png, properties: [:]) {
    try? d.write(to: URL(fileURLWithPath: "\(iconset)/\(name)"))
  }
}

writeSize(16, "icon_16x16.png"); writeSize(32, "icon_16x16@2x.png")
writeSize(32, "icon_32x32.png"); writeSize(64, "icon_32x32@2x.png")
writeSize(128, "icon_128x128.png"); writeSize(256, "icon_128x128@2x.png")
writeSize(256, "icon_256x256.png"); writeSize(512, "icon_256x256@2x.png")
writeSize(512, "icon_512x512.png"); writeSize(1024, "icon_512x512@2x.png")

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset, "-o", "\(outDir)/icon.icns"]
try? iconutil.run()
iconutil.waitUntilExit()
try? fm.removeItem(atPath: iconset)
print("wrote \(outDir)/icon.icns")
