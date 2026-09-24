package com.example.yugiohscanner.cloud

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.time.Instant

/**
 * Kaltstart-Zwischenspeicher (docs/superpowers/aufgaben/2026-09-24-kaltstart-zwischenspeicher.md):
 * der zuletzt geladene Speicherstand samt Abgleich-Stichtagen, auf dem Geraet. Beim naechsten Start
 * zeigt die App ihn sofort und holt nur die Aenderungen seit den Stichtagen.
 *
 * `account` ist die Nutzer-ID aus dem Token (JWT `sub`) -- ein Stand eines anderen Kontos wird nie gezeigt.
 */
data class StoreSnapshot(
    val account: String,
    val savedAt: Instant,
    val cards: List<CardRow>,
    val copies: List<CopyRow>,
    val containers: List<ContainerRow>,
    val cursors: SnapshotCursors,
)

/** Stichtag und Serverzeit je Tabelle, wie `CollectionStoreCore.TableCursor`. */
data class SnapshotCursors(
    val cardsStamp: String? = null, val cardsServer: String? = null,
    val copiesStamp: String? = null, val copiesServer: String? = null,
    val containersStamp: String? = null, val containersServer: String? = null,
)

/** Wo der Stand liegt. Lesen liefert `null` statt zu werfen, wenn nichts Brauchbares da ist. */
interface StoreSnapshotStore {
    fun read(): StoreSnapshot?
    fun write(snapshot: StoreSnapshot)
    fun delete()
}

/** Eine Datei im App-Speicher; geschrieben wird ueber eine Nachbardatei und Umbenennen, nie halb. */
class FileSnapshotStore(private val file: File) : StoreSnapshotStore {
    override fun read(): StoreSnapshot? =
        if (!file.exists()) null
        else runCatching { file.inputStream().use { StoreSnapshotCodec.decode(it) } }.getOrNull()

    override fun write(snapshot: StoreSnapshot) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.outputStream().use { StoreSnapshotCodec.encode(snapshot, it) }
        if (!tmp.renameTo(file)) {
            file.delete()
            if (!tmp.renameTo(file)) { tmp.delete(); error("Zwischenspeicher nicht geschrieben") }
        }
    }

    override fun delete() {
        file.delete()
        File(file.parentFile, file.name + ".tmp").delete()
    }
}

/**
 * Binaerformat statt JSON: ~12 000 Zeilen parst org.json am Handy spuerbar langsam, DataInputStream nicht.
 *
 * WER EIN FELD AN CardRow, CopyRow ODER ContainerRow ERGAENZT, muss es hier schreiben und lesen und
 * [VERSION] erhoehen -- StoreSnapshotCodecTest zaehlt die Felder und schlaegt sonst fehl. Ein Stand mit
 * anderer Version wird nicht gelesen (die App laedt dann einmal vollstaendig aus der Cloud).
 */
object StoreSnapshotCodec {
    const val VERSION = 1
    private const val MAGIC = 0x59474F43 // "YGOC"

    fun encode(s: StoreSnapshot, out: OutputStream) {
        val o = DataOutputStream(BufferedOutputStream(out, 1 shl 16))
        o.writeInt(MAGIC); o.writeInt(VERSION)
        o.writeUTF(s.account); o.writeLong(s.savedAt.toEpochMilli())
        with(s.cursors) {
            for (c in listOf(cardsStamp, cardsServer, copiesStamp, copiesServer, containersStamp, containersServer)) o.str(c)
        }
        o.writeInt(s.cards.size)
        for (c in s.cards) {
            o.writeUTF(c.id); o.writeUTF(c.setCode); o.writeUTF(c.language); o.str(c.name); o.str(c.imageUrl)
            o.str(c.rarity); o.writeInt(c.quantity); o.dbl(c.price); o.str(c.type); o.str(c.desc)
            o.int(c.atk); o.int(c.def); o.int(c.level); o.str(c.race); o.str(c.attribute)
            o.writeBoolean(c.deleted); o.str(c.updatedAt); o.writeInt(c.priceLocked); o.dbl(c.priceFirstEd); o.dbl(c.cmFirstEdFactor)
        }
        o.writeInt(s.copies.size)
        for (c in s.copies) {
            o.writeUTF(c.copyId); o.writeUTF(c.cardId); o.writeUTF(c.setCode); o.writeUTF(c.language); o.writeUTF(c.rarity)
            o.writeUTF(c.edition); o.writeUTF(c.condition); o.writeBoolean(c.deleted); o.str(c.containerId)
            o.int(c.page); o.int(c.slot); o.str(c.tags); o.str(c.note); o.str(c.createdAt); o.str(c.updatedAt); o.writeBoolean(c.forSale)
        }
        o.writeInt(s.containers.size)
        for (c in s.containers) {
            o.writeUTF(c.containerId); o.writeUTF(c.name); o.writeUTF(c.kind); o.int(c.pocketsPerPage); o.str(c.color)
            o.writeInt(c.sortOrder); o.writeBoolean(c.deleted); o.str(c.updatedAt)
        }
        o.flush()
    }

    /** `null` bei fremdem Format oder anderer Version; wirft bei abgeschnittener Datei (FileSnapshotStore faengt das). */
    fun decode(input: InputStream): StoreSnapshot? {
        val i = DataInputStream(BufferedInputStream(input, 1 shl 16))
        if (i.readInt() != MAGIC || i.readInt() != VERSION) return null
        val account = i.readUTF()
        val savedAt = Instant.ofEpochMilli(i.readLong())
        val cursors = SnapshotCursors(i.str(), i.str(), i.str(), i.str(), i.str(), i.str())
        val cards = List(i.count()) {
            CardRow(
                id = i.readUTF(), setCode = i.readUTF(), language = i.readUTF(), name = i.str(), imageUrl = i.str(),
                rarity = i.str(), quantity = i.readInt(), price = i.dbl(), type = i.str(), desc = i.str(),
                atk = i.int(), def = i.int(), level = i.int(), race = i.str(), attribute = i.str(),
                deleted = i.readBoolean(), updatedAt = i.str(), priceLocked = i.readInt(), priceFirstEd = i.dbl(), cmFirstEdFactor = i.dbl(),
            )
        }
        val copies = List(i.count()) {
            CopyRow(
                copyId = i.readUTF(), cardId = i.readUTF(), setCode = i.readUTF(), language = i.readUTF(), rarity = i.readUTF(),
                edition = i.readUTF(), condition = i.readUTF(), deleted = i.readBoolean(), containerId = i.str(),
                page = i.int(), slot = i.int(), tags = i.str(), note = i.str(), createdAt = i.str(), updatedAt = i.str(), forSale = i.readBoolean(),
            )
        }
        val containers = List(i.count()) {
            ContainerRow(
                containerId = i.readUTF(), name = i.readUTF(), kind = i.readUTF(), pocketsPerPage = i.int(), color = i.str(),
                sortOrder = i.readInt(), deleted = i.readBoolean(), updatedAt = i.str(),
            )
        }
        return StoreSnapshot(account, savedAt, cards, copies, containers, cursors)
    }

    private fun DataInputStream.count(): Int = readInt().also { require(it in 0..10_000_000) { "kaputte Laenge" } }

    private fun DataOutputStream.str(v: String?) { writeBoolean(v != null); if (v != null) writeUTF(v) }
    private fun DataOutputStream.int(v: Int?) { writeBoolean(v != null); if (v != null) writeInt(v) }
    private fun DataOutputStream.dbl(v: Double?) { writeBoolean(v != null); if (v != null) writeDouble(v) }
    private fun DataInputStream.str(): String? = if (readBoolean()) readUTF() else null
    private fun DataInputStream.int(): Int? = if (readBoolean()) readInt() else null
    private fun DataInputStream.dbl(): Double? = if (readBoolean()) readDouble() else null
}
