# 原理

## 基础内容

### 7z

以 `7z` 举例，从 `mcmilk/7-Zip` 项目的 `/CPP/7zip/Archive/7z.7zln.cpp` 文件中
```C++
static const Byte *FindSignature_10(const Byte *p, const Byte *limit)
{
  for (;;)
  {
    for (;;)
    {
      if (p >= limit)
        return limit;
      const Byte b = p[5];
      p += 6;
      if (b == Y0) {         break; }
      if (b == Y1) { p -= 1; break; }
      if (b == Y2) { p -= 2; break; }
      if (b == Y3) { p -= 3; break; }
      if (b == Y4) { p -= 4; break; }
      if (b == Y5) { p -= 5; break; }
    }
    if (IS_SIGNATURE(p - 1))
      return p - 1;
  }
}
```

可以看到 `7z` 并不要求文件标识在文件开头，这为此脚本带来了可能性

### MP4

`MP4` 文件由许多 **原子(Atom)/盒子(Box)** 组成

根据 `ISO/IEC 14496-12:2005` 的基本盒子定义：

```c++
aligned(8) class Box (unsigned int(32) boxtype,
        optional unsigned int(8)[16] extended_type) {
    unsigned int(32) size;
    unsigned int(32) type = boxtype;
    if (size==1) {
        unsigned int(64) largesize;
    } else if (size==0) {
        // box extends to end of file
    }
    if (boxtype==‘uuid’) {
        unsigned int(8)[16] usertype = extended_type;
    }
}
```

可以得到每个原子的结构如下（忽略 `extended_type`）

| 属性 | 长度与类型 |
| --- | --- |
| 原子大小（单位：字节） `size` | 32 位无符号整数（大端序） |
| 原子类型 `type` | 4 字节文本 |
| 内容 | (size - 8) 字节 |

如果 `size` 刚好等于 1，则读取额外长度值 `largesize`，如下

| 属性 | 长度与类型 |
| --- | --- |
| `size=0x0001` | 32 位无符号整数（大端序） |
| 原子类型 `type` | 4 字节文本 |
| 原子大小（单位：字节） `largesize` | 64 位无符号整数（大端序） |
| 内容 | (size - 16) 字节 |

> 每个原子的内容里可以嵌套其他原子

一些原子类型：

- `ftyp`: 文件中第一个原子必定为 `ftyp`

- `free` & `skip`: 两种特殊的原子，播放器会跳过其中的内容

- `mdat`: 视频二进制数据

- `moov`: 视频元数据

- `stco` & `co64`: 记录了视频块的偏移量（绝对位置，单位：字节）\
  `stco` 存储 32 位无符号整数偏移量，`co64` 存储 64 位无符号整数偏移量，定义如下：
  
  ```cpp
  aligned(8) class ChunkOffsetBox
          extends FullBox(‘stco’, version = 0, 0) {
      unsigned int(32) entry_count;
      for (i=1; i <= entry_count; i++) {
          unsigned int(32) chunk_offset;
      }
  }
  
  aligned(8) class ChunkLargeOffsetBox
          extends FullBox(‘co64’, version = 0, 0) {
      unsigned int(32) entry_count;
      for (i=1; i <= entry_count; i++) {
          unsigned int(64) chunk_offset;
      }
  }
  ```
  

## 脚本逻辑

由于 `7z` 并不要求文件标识在文件开头，所以将 `7z` 文件数据放入 `MP4` 的 `free` 原子中可以做到让一个文件既能被播放，又能被解压。

理论上，`free` 原子可以放在任意位置。但视频随机数据有可能和文件标识重合，会引起解压缩软件误判压缩包起始位置。为了尽量避免这种情况，就选择将 `free` 原子放在 `ftyp` 后的第一个位置，举例如下：

```
   ftyp
[+]free(额外文件的数据)
   mdat
   moov
```

如果此时播放视频，会发现播放器提示视频损坏。这是因为没有更改 `stco`/`co64` 中存储的绝对偏移量。将其中每一个值都加上新增的 `free` 原子大小即可。

> 注意：若视频很小，而要写入的文件很大，则会出现 32 位无符号整数不够存储偏移量的问题。此时需要将 `stco` 类型改为 `co64` 类型。
