/**
 * 原生选文件夹。aluka:gui 暂无 dialog API，用系统选择器。
 *
 * 必须异步 spawn：同步 spawnSync 会堵住 Aluka 单进程 GUI 消息循环，
 * 系统对话框若落到无边框窗口后面，界面就会一直卡住。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function pickFolder(): Promise<string | undefined> {
  if (process.platform === "win32") {
    const viaPs = await pickFolderWindowsPowerShell();
    if (viaPs !== "failed") return viaPs;
    return pickFolderWindowsWscript();
  }
  if (process.platform === "darwin") return pickFolderMac();
  return pickFolderLinux();
}

/** 成功路径 / 用户取消(undefined) / 进程未能启动("failed") */
function pickFolderWindowsPowerShell(): Promise<string | undefined | "failed"> {
  const ps = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择工作区文件夹'",
    "$dialog.ShowNewFolderButton = $true",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.TopMost = $true",
    "$owner.ShowInTaskbar = $false",
    "$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None",
    "$owner.Size = New-Object System.Drawing.Size(1, 1)",
    "$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual",
    "$owner.Location = New-Object System.Drawing.Point(-4000, -4000)",
    "$owner.Show() | Out-Null",
    "$result = $dialog.ShowDialog($owner)",
    "$selected = $dialog.SelectedPath",
    "$owner.Close()",
    "$owner.Dispose()",
    "$dialog.Dispose()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $selected) { [Console]::Out.Write($selected) }",
  ].join("; ");

  return new Promise((resolve) => {
    const child = spawn(ps, ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => resolve("failed"));
    child.on("close", (code) => {
      const selected = out.trim();
      if (selected) {
        resolve(selected);
        return;
      }
      resolve(code === 0 ? undefined : "failed");
    });
  });
}

function pickFolderWindowsWscript(): Promise<string | undefined> {
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

  fs.writeFileSync(scriptPath, script, "utf8");
  const wscript = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
  return new Promise((resolve) => {
    const child = spawn(wscript, ["//nologo", scriptPath, outPath], { windowsHide: false });
    const finish = () => {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        /* ignore */
      }
      let selected: string | undefined;
      try {
        if (fs.existsSync(outPath)) {
          selected = fs.readFileSync(outPath, "utf8").trim() || undefined;
        }
      } catch {
        selected = undefined;
      }
      try {
        fs.unlinkSync(outPath);
      } catch {
        /* ignore */
      }
      resolve(selected);
    };
    child.on("close", finish);
    child.on("error", finish);
  });
}

function pickFolderMac(): Promise<string | undefined> {
  return spawnCollect("osascript", ["-e", 'POSIX path of (choose folder with prompt "选择工作区文件夹")']).then(
    (selected) => selected?.replace(/\/$/, "") || undefined,
  );
}

function pickFolderLinux(): Promise<string | undefined> {
  return spawnCollect("zenity", ["--file-selection", "--directory", "--title=选择工作区"]);
}

function spawnCollect(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    const finish = (code: number | null) => {
      const selected = out.trim();
      resolve(code === 0 && selected ? selected : undefined);
    };
    child.on("close", finish);
    child.on("error", () => resolve(undefined));
  });
}
