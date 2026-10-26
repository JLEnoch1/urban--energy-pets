// 窗口列表采集 helper:每 500ms 输出屏幕上普通窗口的矩形(JSON 行)
// 只读 bounds/layer/ownerPID,**不读窗口标题**(标题需要屏幕录制权限,本功能不需要)
// 因此无需任何 TCC 权限;过滤逻辑在主进程 lib/ledges.js
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IONBF, 0)

struct Win: Encodable {
    let id: Int
    let pid: Int
    let x: Int
    let y: Int
    let w: Int
    let h: Int
    let layer: Int
}

func emit() {
    guard let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
        return
    }
    var wins: [Win] = []
    for d in list {
        guard
            let id = d[kCGWindowNumber as String] as? Int,
            let layer = d[kCGWindowLayer as String] as? Int,
            let pid = d[kCGWindowOwnerPID as String] as? Int,
            let rectDict = d[kCGWindowBounds as String] as? [String: Any],
            let rect = CGRect(dictionaryRepresentation: rectDict as CFDictionary)
        else { continue }
        wins.append(Win(
            id: id,
            pid: pid,
            x: Int(rect.minX.rounded()),
            y: Int(rect.minY.rounded()),
            w: Int(rect.width.rounded()),
            h: Int(rect.height.rounded()),
            layer: layer
        ))
    }
    if let data = try? JSONEncoder().encode(wins),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

emit()
while true {
    Thread.sleep(forTimeInterval: 0.5)
    emit()
}
