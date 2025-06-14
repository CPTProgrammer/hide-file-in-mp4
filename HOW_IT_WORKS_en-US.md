# How it works

## Fundamentals

### 7z Format

Taking `7z` as an example, from the `/CPP/7zip/Archive/7z.7zln.cpp` file in the `mcmilk/7-Zip` project:
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

This shows that `7z` doesn't require the file signature to be at the beginning of the file, enabling the possibility for this script.

### MP4 Structure

`MP4` files consist of multiple **atoms/boxes**. According to the basic box definition in `ISO/IEC 14496-12:2005`:

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

The structure of each atom is as follows (ignoring `extended_type`):

| Property | Size & Type |
| --- | --- |
| Atom size (bytes) `size` | 32-bit unsigned integer (big-endian) |
| Atom type `type` | 4-byte ASCII |
| Content | (size - 8) bytes |

If `size` equals 1, an additional length value `largesize` is read:

| Property | Size & Type |
| --- | --- |
| `size=0x0001` | 32-bit unsigned integer (big-endian) |
| Atom type `type` | 4-byte ASCII |
| Atom size (bytes) `largesize` | 64-bit unsigned integer (big-endian) |
| Content | (size - 16) bytes |

> Each atom's content may contain nested atoms

Key atom types:
- `ftyp`: Must be the first atom in the file
- `free` & `skip`: Special atoms that players ignore
- `mdat`: Contains actual video/audio data
- `moov`: Contains video metadata
- `stco` & `co64`: Store absolute byte offsets of media data chunks (video/audio samples)\
  `stco` stores 32-bit unsigned integer offsets, `co64` stores 64-bit unsigned integer offsets. Defined as:
  ```cpp
  aligned(8) class ChunkOffsetBox
          extends FullBox('stco', version = 0, 0) {
      unsigned int(32) entry_count;
      for (i=1; i <= entry_count; i++) {
          unsigned int(32) chunk_offset;
      }
  }
  
  aligned(8) class ChunkLargeOffsetBox
          extends FullBox('co64', version = 0, 0) {
      unsigned int(32) entry_count;
      for (i=1; i <= entry_count; i++) {
          unsigned int(64) chunk_offset;
      }
  }
  ```

## Script Logic

Since `7z` doesn't require its signature at the file start, we can insert `7z` data into MP4's `free` atoms, creating a file that's both playable and extractable.

While `free` atoms can be placed anywhere, positioning them immediately after `ftyp` minimizes conflicts with random video data that might mimic compression signatures:

```
   ftyp
[+]free (contains attached file data)
   mdat
   moov
```

However, playback would fail without adjusting the absolute offsets in `stco`/`co64` atoms. The script adds the size of the new `free` atom to every offset value.

> Note: If the attached file is large enough to cause 32-bit overflow in offsets, the script automatically converts `stco` to `co64` boxes.
