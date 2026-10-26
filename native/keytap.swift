// 键位监听 helper:CGEventTap 抓全局 keyDown/keyUp,按行协议输出到 stdout
// K <keycode> / U <keycode> / STATUS ok|no-access
// 需要「系统设置 > 隐私与安全性 > 辅助功能」授权给承载它的进程(终端 / 应用)
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IONBF, 0) // 行必须即时 flush,否则主进程读不到

var tapRef: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        // tap 被系统暂停时重新启用,避免监听静默失效
        if let t = tapRef { CGEvent.tapEnable(tap: t, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    switch type {
    case .keyDown:
        let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) == 1
        if !isRepeat { print("K \(code)") }
    case .keyUp:
        print("U \(code)")
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

let mask =
    CGEventMask(1 << CGEventType.keyDown.rawValue)
    | CGEventMask(1 << CGEventType.keyUp.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly, // 只监听不拦截,绝不吃掉用户按键
    eventsOfInterest: mask,
    callback: callback,
    userInfo: nil
) else {
    print("STATUS no-access")
    exit(2)
}
tapRef = tap

print("STATUS ok")
CFRunLoopAddSource(
    CFRunLoopGetCurrent(),
    CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0),
    .commonModes
)
CGEvent.tapEnable(tap: tap, enable: true)
CFRunLoopRun()
