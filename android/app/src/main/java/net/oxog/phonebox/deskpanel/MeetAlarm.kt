package net.oxog.phonebox.deskpanel

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Federano "Reuniões": the loud "time to join the meeting" alarm. It plays on the alarm stream at full volume (so it is
 * heard even with the tablet's media sound off or low), the device's alarm tone for a few seconds, then a voice saying
 * [text]; the alarm volume is put back as it was afterwards. One alarm at a time.
 */
class MeetAlarm(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var player: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    private var savedVolume = -1
    private val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()

    fun ring(text: String) = main.post {
        stopNow()
        try {
            savedVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
            audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        } catch (_: Exception) { savedVolume = -1 }   // Do Not Disturb may refuse; the alarm still plays at its volume
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        player = try {
            MediaPlayer().apply { setAudioAttributes(attrs); setDataSource(context, uri); isLooping = true; prepare(); start() }
        } catch (_: Exception) { null }
        // after ~6 s of tone, the voice says what it is about
        main.postDelayed({ player?.let { try { it.stop(); it.release() } catch (_: Exception) {} }; player = null; speak(text) }, 6000)
    }

    private fun speak(text: String) {
        var engine: TextToSpeech? = null
        engine = TextToSpeech(context) { status ->
            val t = engine ?: return@TextToSpeech
            if (status != TextToSpeech.SUCCESS) { restore(); t.shutdown(); return@TextToSpeech }
            t.language = Locale.forLanguageTag("pt-BR")
            t.setAudioAttributes(attrs)
            t.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { main.post { if (id == "m2") { restore(); t.shutdown(); if (tts === t) tts = null } } }
                @Deprecated("old API") override fun onError(id: String?) { main.post { restore(); t.shutdown() } }
            })
            // said twice, a moment apart
            t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "m1")
            t.playSilentUtterance(700, TextToSpeech.QUEUE_ADD, "s")
            t.speak(text, TextToSpeech.QUEUE_ADD, null, "m2")
        }
        tts = engine
        main.postDelayed({ restore() }, 30_000)   // whatever happens, the volume comes back
    }

    private fun restore() {
        if (savedVolume >= 0) { try { audio.setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0) } catch (_: Exception) {} }
        savedVolume = -1
    }

    fun stop() = main.post { stopNow() }

    private fun stopNow() {
        player?.let { try { it.stop(); it.release() } catch (_: Exception) {} }
        player = null
        tts?.let { try { it.stop(); it.shutdown() } catch (_: Exception) {} }
        tts = null
        main.removeCallbacksAndMessages(null)
        restore()
    }
}
