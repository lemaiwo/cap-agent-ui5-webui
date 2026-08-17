import { deflateRawSync } from "node:zlib"

/**
 * A minimal ZIP writer.
 *
 * The HTML5 Application Repository takes one zip per app, and mbt only copies
 * an archive the module's own build produced - it does not create one. Fiori
 * projects get this from ui5-task-zipper; this plugin ships a prebuilt UI and
 * has no ui5 build to hook into, so it writes the archive itself.
 *
 * Hand-rolled rather than pulled from npm because this package is a runtime
 * dependency of every consumer's CAP server, and a build-time convenience is a
 * poor reason to put another package in that tree. The format used here is the
 * oldest, most boring subset: no zip64, no data descriptors, no encryption.
 */

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIR = 0x06054b50
const VERSION = 20
const DEFLATED = 8

// A fixed 1980-01-01 timestamp (the DOS epoch, the earliest this format can
// express) keeps the archive byte-identical across builds of identical input.
// Real mtimes would make every rebuild a different artifact and every deploy
// look like a change.
const DOS_TIME = 0
const DOS_DATE = 33

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * Build a zip from `entries`, an array of { name, data }. Names are stored with
 * forward slashes regardless of the platform that produced them — a backslash
 * in a zip entry is a literal filename character, not a separator, so a Windows
 * path would unpack as one long broken name on the server.
 */
export function zipSync(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const { name, data } of entries) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const nameBuf = Buffer.from(name.split("\\").join("/"), "utf8")
    const compressed = deflateRawSync(body)
    const crc = crc32(body)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(DEFLATED, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, compressed)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(CENTRAL_HEADER, 0)
    dir.writeUInt16LE(VERSION, 4)
    dir.writeUInt16LE(VERSION, 6)
    dir.writeUInt16LE(0, 8)
    dir.writeUInt16LE(DEFLATED, 10)
    dir.writeUInt16LE(DOS_TIME, 12)
    dir.writeUInt16LE(DOS_DATE, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(compressed.length, 20)
    dir.writeUInt32LE(body.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt16LE(0, 30)
    dir.writeUInt16LE(0, 32)
    dir.writeUInt16LE(0, 34)
    dir.writeUInt16LE(0, 36)
    dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)

    central.push(dir, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL_DIR, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, directory, end])
}
