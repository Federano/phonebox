package net.oxog.phonebox.deskpanel

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import kotlin.math.abs

/**
 * Federano: while the PC's video is mirrored and the panel app goes to the background, a round bubble floats over the
 * other apps. Tap: back to the mirror. Drag: move it (it snaps to the nearest side). Needs Android's
 * "Display over other apps" permission; without it nothing is shown.
 */
class MirrorBubble(private val context: Context) {
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private var view: View? = null
    private var x = -1
    private var y = -1

    fun allowed(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

    @SuppressLint("ClickableViewAccessibility")
    fun show() {
        if (view != null || !allowed()) return
        val d = context.resources.displayMetrics.density
        val size = (76 * d).toInt()
        val screenW = context.resources.displayMetrics.widthPixels
        val screenH = context.resources.displayMetrics.heightPixels
        if (x < 0) { x = screenW - size - (16 * d).toInt(); y = screenH - size - (120 * d).toInt() }
        val v = PlayIcon(context).apply {
            alpha = 0.85f
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#EB12141A"))
                setStroke((2 * d).toInt(), Color.parseColor("#2EFFFFFF"))
            }
            elevation = 12 * d
            contentDescription = "Voltar ao vídeo do PC"
        }
        @Suppress("DEPRECATION")
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(size, size, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.START; this.x = x; this.y = y }
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false; v.alpha = 1f; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (abs(dx) + abs(dy) > 10 * d) moved = true
                    lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt()
                    try { wm.updateViewLayout(v, lp) } catch (_: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    v.alpha = 0.85f
                    lp.x = if (lp.x + size / 2 < screenW / 2) (12 * d).toInt() else screenW - size - (12 * d).toInt()
                    lp.y = lp.y.coerceIn(0, screenH - size)
                    x = lp.x; y = lp.y
                    try { wm.updateViewLayout(v, lp) } catch (_: Exception) {}
                    if (!moved && e.actionMasked == MotionEvent.ACTION_UP) backToMirror()
                    true
                }
                else -> false
            }
        }
        try { wm.addView(v, lp); view = v } catch (_: Exception) {}
    }

    fun hide() {
        view?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        view = null
    }

    private fun backToMirror() {
        hide()
        context.startActivity(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(EXTRA_RESTORE, true))
    }

    /** A red rounded rectangle with a white "play" triangle. */
    private class PlayIcon(context: Context) : View(context) {
        private val red = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E62117") }
        private val white = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat(); val h = height.toFloat()
            val rw = w * 0.56f; val rh = rw * 0.68f
            val r = RectF((w - rw) / 2, (h - rh) / 2, (w + rw) / 2, (h + rh) / 2)
            canvas.drawRoundRect(r, rh * 0.3f, rh * 0.3f, red)
            val t = rh * 0.42f
            val cx = w / 2 + t * 0.12f; val cy = h / 2
            val p = Path().apply {
                moveTo(cx - t * 0.45f, cy - t * 0.55f); lineTo(cx - t * 0.45f, cy + t * 0.55f); lineTo(cx + t * 0.55f, cy); close()
            }
            canvas.drawPath(p, white)
        }
    }

    companion object {
        const val EXTRA_RESTORE = "federanoRestoreMirror"
    }
}
