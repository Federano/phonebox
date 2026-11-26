package net.oxog.phonebox.deskpanel

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.database.Cursor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Reads the calendar already synchronized by Android. Nothing is sent to the PC or a cloud service.
 * The panel must explicitly call connect/choose before any account is selected or permission is requested.
 * MainActivity checks its bridge key before forwarding a request here.
 */
class TabletCalendar(
    private val activity: Activity,
    private val result: (Int, JSONObject) -> Unit,
    private val changed: () -> Unit,
) {
    companion object {
        const val PERMISSION_REQUEST = 7354
        private const val GOOGLE = "com.google"
        private const val PREFS = "federano_tablet_calendar"
        private const val MAX_INSTANCES = 3000
        private val MEET = Regex("https://meet\\.google\\.com/[a-z0-9-]+", RegexOption.IGNORE_CASE)
    }

    private data class Selection(val name: String, val type: String) {
        val id: String get() = MessageDigest.getInstance("SHA-256")
            .digest("$type\u0000$name".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    private data class LocalCalendar(val id: Long, val account: Selection, val name: String, val color: Int, val enabled: Boolean)
    private data class Pending(val id: Int, val forceChoice: Boolean)

    private val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val resolver = activity.contentResolver
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "FederanoCalendar").apply { isDaemon = true } }
    @Volatile private var closed = false
    @Volatile private var selectionVersion = 0L
    private var active = false
    private var observing = false
    private var pending: Pending? = null
    private var picker: AlertDialog? = null
    private val notifyChanged = Runnable { if (active && !closed) changed() }
    private val observer = object : ContentObserver(main) {
        override fun onChange(selfChange: Boolean) {
            main.removeCallbacks(notifyChanged)
            main.postDelayed(notifyChanged, 350)
        }
    }

    /** Call onResume/onPause. Returning to the foreground rereads the provider even if an observer event was missed. */
    fun start() {
        if (closed) return
        active = true
        observe()
        main.removeCallbacks(notifyChanged)
        main.post(notifyChanged)
    }

    fun stop() {
        active = false
        main.removeCallbacks(notifyChanged)
        if (observing) {
            resolver.unregisterContentObserver(observer)
            observing = false
        }
    }

    fun close() {
        closed = true
        stop()
        picker?.dismiss()
        picker = null
        pending = null
        worker.shutdownNow()
    }

    /** Payload is reserved; account names/IDs from JavaScript are deliberately never accepted as a selection. */
    @Suppress("UNUSED_PARAMETER")
    fun request(id: Int, operation: String, payloadJSON: String = "{}") {
        if (closed) return
        when (operation) {
            "state" -> read(id) { state() }
            "today" -> read(id) { events() }
            "refresh" -> read(id) { refresh() }
            "connect", "choose" -> main.post { connect(Pending(id, operation == "choose")) }
            "disconnect" -> main.post {
                // Cancel a chooser first: its callback must not reconnect an account after disconnect.
                picker?.dismiss()
                picker = null
                pending?.let { reply(it.id, failure("Seleção de agenda cancelada.", "cancelled")) }
                pending = null
                prefs.edit().remove("account_name").remove("account_type").apply()
                selectionVersion++
                changed()
                read(id) { state() }
            }
            else -> reply(id, failure("Operação de agenda inválida.", "invalid_operation"))
        }
    }

    fun onPermissionResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != PERMISSION_REQUEST) return false
        if (closed) return true
        val request = pending ?: return true
        if (grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED || !permissionGranted()) {
            pending = null
            changed()
            read(request.id) { state().put("error", "Permita o acesso à agenda nas configurações do Android para conectar.")
                .put("code", "permission_denied") }
        } else {
            observe()
            select(request)
        }
        return true
    }

    private fun permissionGranted(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
        activity.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    private fun chosen(): Selection? {
        val name = prefs.getString("account_name", null) ?: return null
        val type = prefs.getString("account_type", null) ?: return null
        return if (name.isNotBlank() && type == GOOGLE) Selection(name, type) else null
    }

    private fun observe() {
        if (!active || observing || !permissionGranted() || closed) return
        try {
            resolver.registerContentObserver(CalendarContract.CONTENT_URI, true, observer)
            observing = true
        } catch (_: SecurityException) {
            main.post(notifyChanged)
        }
    }

    private fun connect(request: Pending) {
        if (closed || activity.isFinishing || activity.isDestroyed) return
        if (pending != null) {
            reply(request.id, failure("Já existe uma escolha de agenda aberta.", "busy"))
            return
        }
        pending = request
        prefs.edit().putBoolean("setup_attempted", true).apply()
        if (!permissionGranted() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            activity.requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR), PERMISSION_REQUEST)
        } else select(request)
    }

    private fun select(request: Pending) {
        execute {
            try {
                val calendars = calendars()
                val accounts = calendars.map { it.account }.distinct().sortedBy { it.name.lowercase(Locale.ROOT) }
                val selected = chosen()
                main.post {
                    if (closed || pending != request || activity.isFinishing || activity.isDestroyed) return@post
                    // Persisted choice survives app restarts. Never silently use the first/only Android account.
                    if (!request.forceChoice && selected != null && selected in accounts) {
                        pending = null
                        read(request.id) { state() }
                    } else if (accounts.isEmpty()) {
                        pending = null
                        read(request.id) { state().put("error", "Nenhuma agenda Google foi encontrada. Abra o Google Agenda, ative a sincronização da conta e tente novamente.")
                            .put("code", "no_accounts") }
                    } else {
                        val labels = accounts.map { account ->
                            val count = calendars.count { it.account == account && it.enabled }
                            "${account.name}\n${if (count == 0) "Sem agendas visíveis e sincronizadas" else "$count agenda${if (count == 1) "" else "s"} sincronizada${if (count == 1) "" else "s"}"}"
                        }.toTypedArray()
                        picker = AlertDialog.Builder(activity)
                            .setTitle("Qual conta usar na agenda?")
                            .setSingleChoiceItems(labels, accounts.indexOf(selected)) { dialog, which ->
                                if (pending != request || which !in accounts.indices) return@setSingleChoiceItems
                                val account = accounts[which]
                                prefs.edit().putString("account_name", account.name).putString("account_type", account.type).apply()
                                selectionVersion++
                                pending = null
                                dialog.dismiss()
                                picker = null
                                changed()
                                read(request.id) { state() }
                            }
                            .setNegativeButton("Cancelar") { _, _ -> cancel(request) }
                            .setOnCancelListener { cancel(request) }
                            .create()
                        picker?.show()
                        picker?.getButton(AlertDialog.BUTTON_NEGATIVE)?.isAllCaps = false
                    }
                }
            } catch (_: SecurityException) {
                main.post { pending = null; reply(request.id, failure("O acesso à agenda foi revogado.", "permission_denied")); changed() }
            } catch (_: Exception) {
                main.post { pending = null; reply(request.id, failure("Não foi possível listar as agendas do Android.", "provider_error")) }
            }
        }
    }

    private fun cancel(request: Pending) {
        if (pending != request) return
        pending = null
        picker = null
        read(request.id) { state().put("cancelled", true) }
    }

    private fun calendars(): List<LocalCalendar> {
        val columns = arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.CALENDAR_COLOR, CalendarContract.Calendars.SYNC_EVENTS,
            CalendarContract.Calendars.VISIBLE)
        val rows = mutableListOf<LocalCalendar>()
        resolver.query(CalendarContract.Calendars.CONTENT_URI, columns,
            "${CalendarContract.Calendars.ACCOUNT_TYPE} = ?", arrayOf(GOOGLE), null)?.use { cursor ->
            while (cursor.moveToNext()) {
                val name = cursor.getString(1) ?: continue
                rows += LocalCalendar(cursor.getLong(0), Selection(name, cursor.getString(2)),
                    cursor.getString(3) ?: "Google Agenda", cursor.getInt(4), cursor.getInt(5) == 1 && cursor.getInt(6) == 1)
            }
        } ?: throw IllegalStateException("Calendar provider unavailable")
        return rows
    }

    private fun state(): JSONObject {
        val selected = chosen()
        val granted = permissionGranted()
        val rows = if (granted) calendars() else emptyList()
        val own = rows.filter { it.account == selected }
        val connected = selected != null && granted && own.any { it.enabled }
        return JSONObject().put("supported", true).put("configured", selected != null)
            .put("setupAttempted", prefs.getBoolean("setup_attempted", false) || selected != null)
            .put("connected", connected).put("permissionGranted", granted)
            .put("account", selected?.name ?: JSONObject.NULL).put("connectionId", selected?.id ?: JSONObject.NULL)
            .put("calendars", JSONArray(own.filter { it.enabled }.map { it.name }))
            .also {
                when {
                    selected != null && !granted -> it.put("error", "O acesso à agenda foi revogado. Toque em Conectar agenda para permitir novamente.").put("code", "permission_denied")
                    selected != null && own.isEmpty() -> it.put("error", "A conta escolhida não está mais disponível no tablet. Escolha outra conta.").put("code", "account_removed")
                    selected != null && !connected -> it.put("error", "Ative a sincronização e a visibilidade de pelo menos uma agenda desta conta no Google Agenda.").put("code", "sync_disabled")
                }
            }
    }

    private fun events(): JSONObject {
        val status = state()
        val data = JSONObject(status.toString()).put("source", "tablet").put("today", JSONArray())
            .put("events", JSONArray()).put("calendars", status.optBoolean("connected"))
            .put("localDates", true)
            .put("updatedAt", System.currentTimeMillis())
        if (!status.optBoolean("connected")) return data
        val selected = chosen() ?: return data
        val own = calendars().filter { it.account == selected && it.enabled }.associateBy { it.id }
        if (own.isEmpty()) return data.put("connected", false).put("calendars", false)

        val zone = TimeZone.getDefault()
        val today = Calendar.getInstance(zone).apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
        val todayStart = today.timeInMillis
        val tomorrow = (today.clone() as Calendar).apply { add(Calendar.DATE, 1) }.timeInMillis
        val limit = (today.clone() as Calendar).apply { add(Calendar.DATE, 14) }.timeInMillis
        // All-day rows are UTC dates. Widen the provider range, then filter after converting their dates to local midnight.
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, todayStart - 86_400_000L)
            ContentUris.appendId(it, limit + 86_400_000L)
        }.build()
        val projection = arrayOf(CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END, CalendarContract.Instances.TITLE, CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.CALENDAR_ID, CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.DESCRIPTION, CalendarContract.Instances.STATUS,
            CalendarContract.Instances.SELF_ATTENDEE_STATUS)
        val selection = "${CalendarContract.Instances.CALENDAR_ID} IN (${own.keys.joinToString(",") { "?" }})" +
            " AND (${CalendarContract.Instances.STATUS} IS NULL OR ${CalendarContract.Instances.STATUS} != ?)" +
            " AND (${CalendarContract.Instances.SELF_ATTENDEE_STATUS} IS NULL OR ${CalendarContract.Instances.SELF_ATTENDEE_STATUS} != ?)"
        val args = (own.keys.map { it.toString() } + CalendarContract.Events.STATUS_CANCELED.toString() +
            CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED.toString()).toTypedArray()
        val items = mutableListOf<JSONObject>()
        val eventIds = mutableSetOf<Long>()
        var truncated = false
        resolver.query(uri, projection, selection, args, "${CalendarContract.Instances.BEGIN} ASC")?.use { cursor ->
            while (cursor.moveToNext()) {
                if (items.size >= MAX_INSTANCES) { truncated = true; break }
                val calendar = own[cursor.getLong(5)] ?: continue
                val allDay = cursor.getInt(4) != 0
                val begin = if (allDay) localDay(cursor.getLong(1), zone) else cursor.getLong(1)
                val end = if (allDay) localDay(cursor.getLong(2), zone) else cursor.getLong(2)
                if (end <= todayStart || begin >= limit || end <= begin) continue
                val eventId = cursor.getLong(0)
                eventIds += eventId
                val location = cursor.string(6)
                val description = cursor.string(7)
                val meet = MEET.find("$location\n$description")?.value.orEmpty()
                items += JSONObject().put("id", "tablet:${calendar.id}:$eventId:$begin")
                    .put("eventId", eventId).put("title", cursor.string(3).ifBlank { "Sem título" })
                    .put("start", begin).put("end", end).put("allDay", allDay)
                    .put("calendar", calendar.name).put("color", String.format(Locale.ROOT, "#%06x", calendar.color and 0xffffff))
                    .put("meet", meet).put("location", location).put("people", 0).put("attendees", 0)
            }
        } ?: throw IllegalStateException("Calendar provider unavailable")
        val people = attendeeCounts(eventIds)
        items.forEach { item ->
            val count = people[item.optLong("eventId")] ?: 0
            item.remove("eventId")
            item.put("people", count).put("attendees", count)
        }
        items.sortBy { it.optLong("start") }
        val todays = items.filter { !it.optBoolean("allDay") && it.optLong("start") < tomorrow && it.optLong("end") > todayStart }
        return data.put("events", JSONArray(items)).put("today", JSONArray(todays)).put("truncated", truncated)
    }

    private fun attendeeCounts(ids: Set<Long>): Map<Long, Int> {
        val counts = mutableMapOf<Long, Int>()
        ids.toList().chunked(200).forEach { batch ->
            val where = "${CalendarContract.Attendees.EVENT_ID} IN (${batch.joinToString(",") { "?" }})" +
                " AND (${CalendarContract.Attendees.ATTENDEE_STATUS} IS NULL OR ${CalendarContract.Attendees.ATTENDEE_STATUS} != ?)"
            val args = (batch.map { it.toString() } + CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED.toString()).toTypedArray()
            resolver.query(CalendarContract.Attendees.CONTENT_URI, arrayOf(CalendarContract.Attendees.EVENT_ID), where, args, null)?.use { cursor ->
                while (cursor.moveToNext()) {
                    val eventId = cursor.getLong(0)
                    counts[eventId] = (counts[eventId] ?: 0) + 1
                }
            }
        }
        return counts
    }

    private fun refresh(): JSONObject {
        // Sync remains Android/Google Agenda's responsibility; refreshing never changes its account settings.
        return events()
    }

    private fun localDay(utc: Long, zone: TimeZone): Long {
        val source = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = utc }
        return Calendar.getInstance(zone).apply {
            clear()
            set(source.get(Calendar.YEAR), source.get(Calendar.MONTH), source.get(Calendar.DAY_OF_MONTH), 0, 0, 0)
        }.timeInMillis
    }

    private fun Cursor.string(index: Int): String = if (isNull(index)) "" else getString(index).orEmpty()

    private fun read(id: Int, action: () -> JSONObject) {
        execute {
            val version = selectionVersion
            val response = try { action() }
            catch (_: SecurityException) { failure("O acesso à agenda foi revogado. Conecte a agenda novamente.", "permission_denied") }
            catch (_: Exception) { failure("Não foi possível ler a agenda do Android. Abra o Google Agenda e tente novamente.", "provider_error") }
            main.post {
                if (version != selectionVersion) {
                    // Never deliver a delayed query belonging to a previously selected account.
                    reply(id, failure("A conta da agenda foi alterada. Atualize novamente.", "account_changed"))
                } else if (response.optBoolean("permissionGranted") && !permissionGranted()) {
                    reply(id, failure("O acesso à agenda foi revogado. Conecte a agenda novamente.", "permission_denied"))
                } else reply(id, response)
            }
        }
    }

    private fun failure(message: String, code: String): JSONObject = JSONObject().put("supported", true)
        .put("configured", chosen() != null).put("connected", false).put("permissionGranted", permissionGranted())
        .put("setupAttempted", prefs.getBoolean("setup_attempted", false) || chosen() != null).put("localDates", true)
        .put("source", "tablet").put("today", JSONArray()).put("events", JSONArray()).put("calendars", false)
        .put("account", chosen()?.name ?: JSONObject.NULL).put("connectionId", chosen()?.id ?: JSONObject.NULL)
        .put("error", message).put("code", code)

    private fun execute(task: () -> Unit) {
        if (closed) return
        try { worker.execute { if (!closed) task() } } catch (_: RejectedExecutionException) { }
    }

    private fun reply(id: Int, response: JSONObject) {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { reply(id, response) }; return }
        if (!closed && !activity.isFinishing && !activity.isDestroyed) result(id, response)
    }
}
