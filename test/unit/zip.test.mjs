import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { zipSync } from "../../lib/zip.mjs"

const tmp = () => mkdtempSync(join(tmpdir(), "cap-agent-zip-"))

/**
 * Round-trip through a real unzip implementation. A hand-written ZIP that only
 * this file's own reader accepts would prove nothing — the consumer that
 * matters is SAP's repository, and the closest available stand-in is the
 * system's unzip.
 */
function extract(buf) {
  const dir = tmp()
  const file = join(dir, "a.zip")
  writeFileSync(file, buf)
  try {
    execFileSync("unzip", ["-qq", "-o", file, "-d", join(dir, "out")])
  } catch (err) {
    // Distinguish "the archive is broken" from "there is no unzip here", which
    // otherwise both surface as an opaque spawn failure.
    if (err.code === "ENOENT") throw new Error("these tests need the `unzip` binary on PATH")
    throw err
  }
  return join(dir, "out")
}

test("a real unzip can read the archive, with contents intact", () => {
  const out = extract(zipSync([{ name: "index.html", data: "<html>hi</html>" }]))
  assert.equal(readFileSync(join(out, "index.html"), "utf8"), "<html>hi</html>")
})

test("nested paths survive as directories", () => {
  const out = extract(zipSync([{ name: "css/style.css", data: ".a{color:red}" }]))
  assert.equal(readFileSync(join(out, "css", "style.css"), "utf8"), ".a{color:red}")
})

// A backslash is a literal filename character in a zip entry, not a separator,
// so a Windows-shaped path would unpack as one long broken name on the server.
test("backslashes in names are normalised to forward slashes", () => {
  const out = extract(zipSync([{ name: "a\\b\\c.txt", data: "deep" }]))
  assert.equal(readFileSync(join(out, "a", "b", "c.txt"), "utf8"), "deep")
})

test("binary content round-trips byte for byte", () => {
  const data = Buffer.from([0, 1, 2, 255, 254, 0, 128, 77])
  const out = extract(zipSync([{ name: "bin", data }]))
  assert.deepEqual(readFileSync(join(out, "bin")), data)
})

test("content larger than one deflate block round-trips", () => {
  const data = Buffer.from("x".repeat(200_000) + "END")
  const out = extract(zipSync([{ name: "big.txt", data }]))
  assert.equal(readFileSync(join(out, "big.txt"), "utf8").endsWith("END"), true)
})

test("multiple entries all land, with the right contents", () => {
  const out = extract(
    zipSync([
      { name: "a.txt", data: "A" },
      { name: "b/c.txt", data: "C" },
      { name: "manifest.json", data: '{"x":1}' },
    ]),
  )
  assert.equal(readFileSync(join(out, "a.txt"), "utf8"), "A")
  assert.equal(readFileSync(join(out, "b", "c.txt"), "utf8"), "C")
  assert.equal(readFileSync(join(out, "manifest.json"), "utf8"), '{"x":1}')
})

// The plugin's dist/ is committed and CI compares rebuilds byte for byte; an
// archive stamped with real mtimes would differ on every run.
test("the same input always produces the same bytes", () => {
  const entries = [{ name: "a.txt", data: "A" }]
  assert.deepEqual(zipSync(entries), zipSync(entries))
})

// Asserted structurally rather than through unzip: unzip exits non-zero on an
// empty archive by policy ("zipfile is empty"), which says nothing about
// whether the bytes are well formed. 22 bytes is the canonical
// end-of-central-directory record with no entries.
test("an empty archive is the canonical 22-byte end-of-central-directory record", () => {
  const buf = zipSync([])
  assert.equal(buf.length, 22)
  assert.equal(buf.readUInt32LE(0), 0x06054b50)
  assert.equal(buf.readUInt16LE(10), 0, "entry count")
})

test("unzip reports no corruption", () => {
  const dir = tmp()
  const file = join(dir, "t.zip")
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, zipSync([{ name: "a.txt", data: "A" }, { name: "b/c.bin", data: Buffer.from([1, 2, 3]) }]))

  // -t is unzip's own integrity check: CRCs and central directory consistency.
  const out = execFileSync("unzip", ["-t", file], { encoding: "utf8" })
  assert.match(out, /No errors detected/)
})
