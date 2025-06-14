/**
 * ! Approximately 3/5 of this script's code was written by DeepSeek-R1-0528 !
 * 
 * Purpose: Writes file data into an MP4 video while generally maintaining playability.
 *     There are no file size restrictions - the program handles all sizes automatically.
 * 
 * The file data is placed in a free space box positioned immediately after the ftyp header.
 * This minimizes interference from random video data (e.g., preventing compression tools from misidentifying signatures).
 * The resulting MP4 structure is typically: ftyp, free (containing the embedded data), mdat, moov.
 * 
 * Recommended: Node.js >= 20 (lower versions untested)
 * 
 * Command line usage:
 * node hide_file_in_mp4.js -o <output path, .mp4 suffix recommended> <MP4 video path> --attach-file <file to embed>
 * Example: node hide_file_in_mp4.js -o "./Bad Apple (extract me!).mp4" "./Touhou - Bad Apple.mp4" --attach-file "./Bad Apple.7z"
 * 
 * ! 本脚本代码有约 60% 为 DeepSeek-R1-0528 编写 !
 * 
 * 用途：将文件数据写入进 mp4 视频，一般可以保证视频能播放
 *     文件没有大小限制，程序会自动处理
 * 
 * 文件数据所在 free space box 会写入紧挨着 ftyp 头的下一个位置，以最大程度减少视频数据干扰（eg. 干扰解压缩软件识别文件标识）
 * 写入后的 mp4 文件区域一般为： ftyp, free(数据所在位置), mdat, moov
 * 
 * 推荐：Node.js >= 20 （更低的版本未测试）
 * 
 * 使用方法（命令行）：
 * node hide_file_in_mp4.js -o <输出文件路径（建议后缀为mp4）> <MP4视频路径> --attach-file <要写进视频的文件路径>
 * 例子：node hide_file_in_mp4.js -o "./Bad Apple (extract me!).mp4" "./Touhou - Bad Apple.mp4" --attach-file "./Bad Apple.7z"
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const process = require("process");

class PartialBuffer{
	buffer;
	offset;
	owedLength;
	outputStream;
	flushCallback;

	/**
	 * @param {fs.WriteStream} outputStream 
	 * @param {(flushedLength: number) => void} flushCallback
	 */
	constructor(outputStream, flushCallback) {
		this.buffer = Buffer.alloc(0);
		this.offset = 0;
		this.owedLength = 0;
		this.outputStream = outputStream;
		this.flushCallback = flushCallback;

		return new Proxy(this, {
			get(target, prop) {
				if (prop in target) {
					return target[prop];
				}

				const value = target.buffer[prop];

				return typeof value === "function" ? value.bind(target.buffer) : value;
			},
			set(target, prop, newValue) {
				if (prop in target) {
					target[prop] = newValue;
					return true;
				}
				return false;
			},
		});
	}

	/**
	 * @param {Buffer} newBuf 
	 */
	push(newBuf) {
		this.buffer = Buffer.concat([this.buffer, newBuf]);
		if (this.owedLength > 0) {
			this.flush(this.owedLength);
		}
	}

	/**
	 * @param {number} length 
	 * @param {boolean} writeFlushed
	 */
	flush(length, writeFlushed = true) {
		let actualLength = length;
		if (length > this.buffer.length) {
			actualLength = this.buffer.length;
			this.owedLength = length - this.buffer.length;
		} else {
			this.owedLength = 0;
		}
		if (writeFlushed) this.outputStream.write(this.buffer.subarray(0, actualLength));
		this.buffer = Buffer.from(this.buffer.subarray(actualLength));
		this.offset += actualLength;

		if (writeFlushed) this.flushCallback(actualLength);
		// return actualLength;
	}

	/**
	 * @param {number} length 
	 */
	unshift(length) {
		this.buffer = Buffer.concat([Buffer.allocUnsafe(length), this.buffer]);
	}
}

// Command line argument parsing
// 命令行参数解析
function parseArgs() {
	const args = process.argv.slice(2);
	let outputPath = null;
	let videoPath = null;
	let attachFilePath = null;
	let flag = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-o" && i + 1 < args.length) {
			outputPath = args[i + 1];
			i++;
		} else if (arg === "--attach-file" && i + 1 < args.length) {
			attachFilePath = args[i + 1];
			i++;
		} else if (!arg.startsWith("-")) {
			videoPath = arg;
		} else {
			flag = true;
		}
	}

	if (!videoPath || !outputPath || !attachFilePath || flag) {
		console.error("Usage: node hide_file_in_mp4.js -o <output> <video> --attach-file <file>");
		process.exit(1);
	}

	return { videoPath, outputPath, attachFilePath };
}

// Generate random bytes
// 生成随机字节
function generateRandomBytes(size) {
	return crypto.randomBytes(size);
}

// Compressed file signature
// 压缩文件特征码
const FILE_SIGNATURES = {
	RAR4: Buffer.from("\x52\x61\x72\x21\x1A\x07\x00", "binary"), // Rar!
	RAR5: Buffer.from("\x52\x61\x72\x21\x1A\x07\x01\x00", "binary"), // Rar!
	ZIP: Buffer.from("\x50\x4B\x03\x04", "binary"), // PK␃␄
	GZIP: Buffer.from("\x1F\x8B", "binary"), // ␟‹
	BZIP2: Buffer.from("\x42\x5A\x68", "binary"), // BZh
	XZ: Buffer.from("\xFD\x37\x7A\x58\x5A\x00", "binary"), // ý7zXZ␀
	SEVEN_Z: Buffer.from("\x37\x7A\xBC\xAF\x27\x1C", "binary"), // 7z¼¯'␜		or		7z¼¯'
};

// Create empty mdat box
// 创建空的mdat box
function createEmptyMdatBox() {
	const box = Buffer.alloc(8);
	box.writeUInt32BE(8, 0); // Box size (8 bytes)
	box.write("mdat", 4); // Box type
	return box;
}

// Update progress display
// 更新进度显示
let lastUpdateTimestamp = 0;
const INTERVAL = 100;
function updateProgress(processed, total) {
	const currentTimestamp = Date.now();
	if (currentTimestamp - lastUpdateTimestamp >= INTERVAL) {
		lastUpdateTimestamp = currentTimestamp;
		const percent = Math.round((processed / total) * 100);
		process.stdout.clearLine();
		process.stdout.cursorTo(0);
		process.stdout.write(`Progress: ${percent}% ( ${parseSize(processed)} / ${parseSize(total)} )`);
	}
}

function parseSize(bytes) {
	return (Math.round(bytes / 1024) / 1024).toFixed(2) + " MiB";
}

/**
 * @param {Buffer} buffer 
 */
function isValidAtomType(buffer) {
	for (let i = 0; i < buffer.length; i++) {
		if (buffer[i] !== 32 && 
			!(buffer[i] >= 48 && buffer[i] <= 57) && 
			!(buffer[i] >= 65 && buffer[i] <= 90) &&
			!(buffer[i] >= 97 && buffer[i] <= 122)
		){
			return false;
		}
	}
	return true;
}

async function hideFileInVideo(videoPath, attachFilePath, outputPath) {
	if (fs.existsSync(outputPath)) {
		console.error("The output path already exists.");
		process.exit(1);
	}

	// Get file size
	// 获取文件大小
	const videoSize = fs.statSync(videoPath).size;
	const attachSize = fs.statSync(attachFilePath).size;
	// const totalSize = videoSize + attachSize;
	let processedBytes = 0;

	console.log(`Hiding file: ${path.basename(attachFilePath)}`);
	console.log(`Cover video: ${path.basename(videoPath)}`);
	console.log("");

	try {
		// Create output file stream
		// 创建输出文件流
		const outputStream = fs.createWriteStream(outputPath);

		// 1. Read first 8 bytes of video file to get ftyp atom size
		// 1. 读取视频文件前8字节获取ftyp原子大小
		const videoFd = fs.openSync(videoPath, "r");
		const headerBuffer = Buffer.alloc(8);
		fs.readSync(videoFd, headerBuffer, 0, 8, 0);

		// Validate ftyp atom
		// 验证ftyp原子
		if (headerBuffer.toString("utf8", 4, 8) !== "ftyp") {
			console.error("Invalid MP4 file: ftyp atom not found at start");
			process.exit(1);
		}

		// Get ftyp atom size
		// 获取ftyp原子大小
		const ftypSize = headerBuffer.readUInt32BE(0);
		fs.closeSync(videoFd);

		// 2. Recreate video stream (from start to end of ftyp)
		// 2. 重新创建视频流（从开始到ftyp结束）
		const ftypStream = fs.createReadStream(videoPath, {
			start: 0,
			end: ftypSize - 1,
		});

		// 3. Remaining video data stream
		// 3. 剩余视频数据流
		const restVideoStream = fs.createReadStream(videoPath, {
			start: ftypSize,
		});

		const attachStream = fs.createReadStream(attachFilePath);

		// 4. Create obfuscation data
		// 4. 创建混淆数据
		const signatures = Object.values(FILE_SIGNATURES);
		const sig1 = signatures[Math.floor(Math.random() * signatures.length)];
		const sig2 = signatures[Math.floor(Math.random() * signatures.length)];
		const randomSize1 = 1024 * (5 + Math.floor(Math.random() * 6));
		const randomSize2 =
			1024 * (5 + Math.floor(Math.random() * 6)) + (4 - ((sig1.length + sig2.length + attachSize) % 4));
		const confusionData = Buffer.concat([
			sig1,
			generateRandomBytes(randomSize1),
			sig2,
			generateRandomBytes(randomSize2),
		]);

		// 5. Calculate free atom size
		// 5. 计算free原子大小
		const freeContentSize = attachSize + confusionData.length;
		let freeHeader;
		/** @type {bigint | number} */
		let freeHeaderSize;
		const freeHeaderCode = "free";

		// 6. Create free atom header
		// 6. 创建free原子头部
		if (freeContentSize < 0x100000000) {
			// < 4GB
			// Standard 4-byte size
			// 标准4字节大小
			freeHeader = Buffer.alloc(8);
			freeHeaderSize = 8 + freeContentSize;
			freeHeader.writeUInt32BE(8 + freeContentSize, 0); // 头部8字节 + 内容  // Header (8 bytes) + content
			freeHeader.write(freeHeaderCode, 4);
		} else if (freeContentSize >= Number.MAX_SAFE_INTEGER) {
			throw new Error(`The attach file is too big (size bigger than ${Number.MAX_SAFE_INTEGER})`);
		} else {
			// Extended size format
			// 扩展大小格式
			freeHeader = Buffer.alloc(16);
			freeHeader.writeUInt32BE(1, 0); // 特殊标记，表示使用扩展大小  // Special marker indicating extended size
			freeHeader.write(freeHeaderCode, 4);
			// Write 64-bit size (16-byte header + content size)
			// 写入64位大小 (16字节头部 + 内容大小)
			const bigSize = 16n + BigInt(freeContentSize);
			freeHeaderSize = bigSize;
			freeHeader.writeBigUInt64BE(bigSize, 8);
		}

		let totalSize = videoSize + freeContentSize + freeHeader.length;

		// 7. Pipeline processing
		// 7. 管道处理
		// 7.1 Write ftyp atom
		// 7.1 写入ftyp原子
		for await (const chunk of ftypStream) {
			outputStream.write(chunk);
			processedBytes += chunk.length;
			updateProgress(processedBytes, totalSize);
		}

		// 7.2 Write free atom header
		// 7.2 写入free原子头部
		outputStream.write(freeHeader);
		processedBytes += freeHeader.length;

		// 7.3 Write attached file
		// 7.3 写入附加文件
		for await (const chunk of attachStream) {
			outputStream.write(chunk);
			processedBytes += chunk.length;
			updateProgress(processedBytes, totalSize);
		}

		// 7.4 Write obfuscation data
		// 7.4 写入混淆数据
		outputStream.write(confusionData);
		processedBytes += confusionData.length;
		updateProgress(processedBytes, totalSize);

		// 7.5 Write remaining video data and adjust absolute offsets in stco/co64
		// 7.5 写入剩余视频数据，并修改 stco 和 co64 的绝对偏移量
		/** @type {{ size: number | bigint, type: string, readSize: bigint, position: number }[]} */
		const atoms = [];
		const popAtom = () => {
			atoms[atoms.length - 1].readSize = BigInt(atoms[atoms.length - 1].size);
			const lastAtom = atoms[atoms.length - 1];
			while (atoms[atoms.length - 1].readSize === BigInt(atoms[atoms.length - 1].size)) {
				const tempAtom = atoms.pop();
				if (atoms.length > 0) {
					atoms[atoms.length - 1].readSize += BigInt(tempAtom.size);
				} else {
					break;
				}
			}
			return lastAtom;
		};
		/** @type {Map<number, number>} */
		const positionsOfIncrements = new Map();
		let remainingChunkOffsets = 0;
		const statusEnum = {
			HEADER: 8,
			EXTENDED_HEADER: 8,
			ADDITION: 4,
			ENTRY_COUNT: 4,
			UINT32_CHUNK_OFFSET: 4,
			UINT64_CHUNK_OFFSET: 8,
		};
		/** @type {keyof statusEnum} */
		let status = "HEADER";
		/** @type {"stco" | "co64"} */
		let writeChunkOffsetType = "stco";

		// let lastPrintStr = "";

		/** @type {PartialBuffer & Buffer} */
		const buffer = new PartialBuffer(outputStream, (flushedLength) => {
			processedBytes += flushedLength;
		});
		for await (const chunk of restVideoStream) {
			buffer.push(chunk);
			while (buffer.length >= statusEnum[status]) {
				// if (lastPrintStr !== atoms.map(v => v.type).join(" ")) {
				// 	lastPrintStr = atoms.map(v => v.type).join(" ");
				// 	console.log(lastPrintStr);
				// }

				switch (status) {
					case "HEADER":
						const atomType = buffer.subarray(4, 8);
						if (isValidAtomType(atomType)) {
							const atom = {
								size: buffer.readUInt32BE(0),
								type: atomType.toString("ascii"),
								readSize: 8n,
								position: processedBytes,
							};
							atoms.push(atom);

							if (atom.size === 1) {
								status = "EXTENDED_HEADER";
								buffer.flush(8);
								continue;
							} else if (atom.size === 8) {
								atoms.pop();
							}

							if (atom.type === "stco") {
								status = "ADDITION";
								if (totalSize >= 0x100000000) {
									writeChunkOffsetType = "co64";
									const prefixLength = 8 + 4 + 4;
									const increment = atom.size - prefixLength;
									totalSize += increment;
									buffer.writeUInt32BE((atom.size - prefixLength) * 2 + prefixLength, 0);

									// Edit previous sizes
									for (let i = 0; i < atoms.length - 1; i++) {
										// console.log(atoms[i]);
										const oldIncrement = positionsOfIncrements.get(atoms[i].position);
										positionsOfIncrements.set(
											atoms[i].position,
											(oldIncrement !== undefined ? oldIncrement : 0) + increment
										);
									}

									buffer.flush(4);
									buffer.write("co64", "ascii");
									buffer.flush(4);
								} else {
									buffer.flush(8);
								}
							} else if (atom.type === "co64") {
								status = "ADDITION";
								buffer.flush(8);
							} else {
								buffer.flush(8);
							}
						} else {
							const lastAtom = popAtom();
							buffer.flush(lastAtom.size - (lastAtom.size >= 0x100000000 ? 16 : 8));
						}
						break;
					case "EXTENDED_HEADER":
						atoms[atoms.length - 1].size = buffer.readBigUInt64BE(8);
						atoms[atoms.length - 1].readSize = 16n;
						buffer.flush(8);
						status = "HEADER";
						if (atoms[atoms.length - 1].type === "stco") {
							status = "ADDITION_STCO";
						} else if (atoms[atoms.length - 1].type === "co64") {
							status = "ADDITION_CO64";
						}
						break;
					case "ADDITION":
						buffer.flush(statusEnum[status]);
						status = "ENTRY_COUNT";
						break;
					case "ENTRY_COUNT":
						remainingChunkOffsets = buffer.readUInt32BE(0);
						buffer.flush(statusEnum[status]);
						if (remainingChunkOffsets > 0) {
							status =
								atoms[atoms.length - 1].type === "stco" ? "UINT32_CHUNK_OFFSET" : "UINT64_CHUNK_OFFSET";
						} else {
							popAtom();
							status = "HEADER";
						}
						break;
					case "UINT32_CHUNK_OFFSET": {
						const offset = buffer.readUInt32BE(0);
						if (writeChunkOffsetType === "stco") {
							buffer.writeUInt32BE(offset + freeHeaderSize);
							buffer.flush(4);
						} else if (writeChunkOffsetType === "co64") {
							// buffer.unshift(4);
							// buffer.writeBigUInt64BE((typeof freeHeaderSize === "bigint" ? BigInt(offset) : offset) + freeHeaderSize);
							// buffer.flush(8);
							buffer.flush(4, false);
							const newOffsetBuf = Buffer.allocUnsafe(8);
							newOffsetBuf.writeBigUInt64BE(
								(typeof freeHeaderSize === "bigint" ? BigInt(offset) : offset) + freeHeaderSize
							);
							outputStream.write(newOffsetBuf);
							processedBytes += 8;
						}
						remainingChunkOffsets--;
						if (remainingChunkOffsets === 0) {
							popAtom();
							status = "HEADER";
						}
						break;
					}
					case "UINT64_CHUNK_OFFSET":
						const offset = buffer.readBigUInt64BE(0);
						buffer.writeBigUInt64BE(offset + BigInt(freeHeaderSize));
						buffer.flush(8);
						remainingChunkOffsets--;
						if (remainingChunkOffsets === 0) {
							popAtom();
							status = "HEADER";
						}
						break;
				}
			}

			updateProgress(processedBytes, totalSize);
		}

		// // 1. 写入原视频内容
		// const videoStream = fs.createReadStream(videoPath);
		// for await (const chunk of videoStream) {
		// 	outputStream.write(chunk);
		// 	processedBytes += chunk.length;
		// 	updateProgress(processedBytes, totalSize);
		// }

		// // 2. 写入MOOV头部
		// const moovSize = attachSize + 8; // 附加文件大小 + 头部大小
		// let moovHeader;

		// if (moovSize <= 0xffffffff) {
		// 	moovHeader = Buffer.alloc(8);
		// 	moovHeader.write("moov", 0);
		// 	moovHeader.writeUInt32BE(moovSize, 4);
		// } else {
		// 	moovHeader = Buffer.alloc(16);
		// 	moovHeader.write("moov", 0);
		// 	moovHeader.writeUInt32BE(1, 4); // 表示使用扩展大小
		// 	moovHeader.writeBigUInt64BE(BigInt(moovSize), 8);
		// }
		// outputStream.write(moovHeader);

		// // 3. 写入附加文件内容
		// const attachStream = fs.createReadStream(attachFilePath);
		// for await (const chunk of attachStream) {
		// 	outputStream.write(chunk);
		// 	processedBytes += chunk.length;
		// 	updateProgress(processedBytes, totalSize);
		// }

		// // // 4. 添加混淆数据
		// // const signatures = Object.values(FILE_SIGNATURES);

		// // // 第一组混淆数据
		// // const sig1 = signatures[Math.floor(Math.random() * signatures.length)];
		// // const randomSize1 = 1024 * (5 + Math.floor(Math.random() * 6)); // 5-10KB
		// // const randomBytes1 = generateRandomBytes(randomSize1);

		// // outputStream.write(sig1);
		// // outputStream.write(randomBytes1);

		// // // 第二组混淆数据
		// // const sig2 = signatures[Math.floor(Math.random() * signatures.length)];
		// // const randomSize2 = 1024 * (5 + Math.floor(Math.random() * 6)); // 5-10KB
		// // const randomBytes2 = generateRandomBytes(randomSize2);

		// // outputStream.write(sig2);
		// // outputStream.write(randomBytes2);

		// // 5. 添加空的mdat box
		// outputStream.write(createEmptyMdatBox());

		// Finish writing
		// 完成写入
		outputStream.end();

		// Wait for stream closure
		// 等待流关闭
		await new Promise((resolve) => outputStream.on("close", resolve));

		// Update parent atom/box size
		// 更新父级 box size
		if (positionsOfIncrements.size > 0) {
			const outputFd = await fs.promises.open(outputPath, "r+");

			for (const [position, increment] of positionsOfIncrements.entries()) {
				// console.log(position, ":+", increment);

				const tempBuf = Buffer.allocUnsafe(4);
				await outputFd.read(tempBuf, 0, 4, position);
				const oldSize = tempBuf.readUInt32BE(0);
				if (oldSize === 1) {
					const tempBuf2 = Buffer.allocUnsafe(8);
					await outputFd.read(tempBuf2, 0, 8, position + 8);
					const oldLargeSize = tempBuf2.readBigUInt64BE(0);
					tempBuf2.writeBigUInt64BE(oldLargeSize + BigInt(increment));
					await outputFd.write(tempBuf2, 0, 8, position + 8);
				} else {
					// ! May cause error when oldSize + increment >= 0x100000000
					tempBuf.writeUInt32BE(oldSize + increment);
					await outputFd.write(tempBuf, 0, 4, position);
				}
			}

			await outputFd.close();
		}

		console.log("\nSuccess! Output file created:", outputPath);
		console.log("Original video size: ", parseSize(videoSize));
		console.log("Attached file size: ", parseSize(attachSize));
		console.log("Final size: ", parseSize(fs.statSync(outputPath).size));
	} catch (error) {
		console.error("\nError:", error);
		process.exit(1);
	}
}

// Main program
// 主程序
(async () => {
	console.log("Recommend: .7z .xz .rar");
	console.log("A note for MP4: The 'moov' box should be after the 'mdat' box.");

	const { videoPath, outputPath, attachFilePath } = parseArgs();

	// Check file existence
	// 检查文件存在
	if (!fs.existsSync(videoPath)) {
		console.error(`Video file not found: ${videoPath}`);
		process.exit(1);
	}

	if (!fs.existsSync(attachFilePath)) {
		console.error(`Attach file not found: ${attachFilePath}`);
		process.exit(1);
	}

	await hideFileInVideo(videoPath, attachFilePath, outputPath);
})();
