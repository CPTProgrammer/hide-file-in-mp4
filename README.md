# Hide File in MP4

## English

A script to hide files in MP4 videos using free-space injection while preserving playback.

> **Note: Approximately 60% of this script was written by AI (DeepSeek-R1-0528)**

### Usage

Recommended: Node.js >= v20.0 (lower versions untested)

> _Perhaps writing this script in C++ would be better?_

```bash
node hide_file_in_mp4.js -o <output file path, .mp4 suffix recommended> <MP4 video path> --attach-file <path to the file to write into the video>

# Example
node hide_file_in_mp4.js -o "./Bad Apple (extract me!).mp4" "./Touhou - Bad Apple.mp4" --attach-file "./Bad Apple.7z"
```

> If writing file types like 7z, xz, rar (which don't require the file signature to be at the beginning) into the video,
> the output file can both be played as a video and extracted as a compressed archive.

### Principle

See `HOW_IT_WORKS_en-US.md`

## 简体中文

一个可以将文件写入 MP4 并保持视频可播放的脚本

> **注意：这个脚本有约 60% 为 AI(DeepSeek-R1-0528) 编写**

### 使用方法

推荐：Node.js >= v20.0 （未测试更低版本）

> _或许使用 C++ 编写这个脚本会更好？_

```bash
node hide_file_in_mp4.js -o <输出文件路径，建议后缀为mp4> <MP4视频路径> --attach-file <要写进视频的文件路径>

# 例子
node hide_file_in_mp4.js -o "./Bad Apple (extract me!).mp4" "./Touhou - Bad Apple.mp4" --attach-file "./Bad Apple.7z"
```

> 如果将 7z, xz, rar 等不要求文件标识在起始位置的文件类型的文件写入脚本，
> 那么输出文件既可以被当做视频播放，也可以被视为压缩包解压。

### 原理

请查看 `HOW_IT_WORKS_zh-Hans.md`
