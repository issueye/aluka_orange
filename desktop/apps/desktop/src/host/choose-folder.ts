/**
 * 原生选文件夹。aluka:gui 暂无 dialog API，用系统选择器。
 * Windows 用 wscript + Shell.BrowseForFolder，避免弹出 PowerShell 控制台和空白窗体。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function pickFolder(): string | undefined {
  if (process.platform === "win32") return pickFolderWindows();
  if (process.platform === "darwin") return pickFolderMac();
  return pickFolderLinux();
}

function pickFolderWindows(): string | undefined {
  const stamp = `${process.pid}-${Date.now()}`;
  const dir = os.tmpdir();
  const scriptPath = path.join(dir, `aluka-folder-${stamp}.vbs`);
  const outPath = path.join(dir, `aluka-folder-${stamp}.txt`);
  const script = [
    "Option Explicit",
    "Dim shell, folder, fso, stream, outPath",
    "outPath = WScript.Arguments.Item(0)",
    'Set shell = CreateObject("Shell.Application")',
    // BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE
    'Set folder = shell.BrowseForFolder(0, "选择工作区文件夹", &H41)',
    "If folder Is Nothing Then WScript.Quit 1",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    "Set stream = fso.CreateTextFile(outPath, True)",
    "stream.Write folder.Self.Path",
    "stream.Close",
  ].join("\r\n");

  try {
    fs.writeFileSync(scriptPath, script, "utf8");
    spawnSync(
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe"),
      ["//nologo", scriptPath, outPath],
      { windowsHide: true, encoding: "utf8" },
    );
    if (!fs.existsSync(outPath)) return undefined;
    const selected = fs.readFileSync(outPath, "utf8").trim();
    return selected || undefined;
  } catch {
    return undefined;
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
  }
}

function pickFolderMac(): string | undefined {
  const result = spawnSync(
    "osascript",
    ["-e", 'POSIX path of (choose folder with prompt "选择工作区文件夹")'],
    { encoding: "utf8" },
  );
  const selected = (result.stdout ?? "").trim().replace(/\/$/, "");
  return result.status === 0 && selected ? selected : undefined;
}

function pickFolderLinux(): string | undefined {
  const result = spawnSync("zenity", ["--file-selection", "--directory", "--title=选择工作区"], {
    encoding: "utf8",
  });
  const selected = (result.stdout ?? "").trim();
  return result.status === 0 && selected ? selected : undefined;
}
