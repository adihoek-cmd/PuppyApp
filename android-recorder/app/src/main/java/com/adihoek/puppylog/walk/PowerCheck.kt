package com.adihoek.puppylog.walk

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Battery saver can switch GPS off while the screen is off, leaving gaps in the route. */
object PowerCheck {
    fun hurtsGps(ctx: Context): Boolean {
        val pm = ctx.getSystemService(PowerManager::class.java) ?: return false
        if (!pm.isPowerSaveMode) return false
        // Android 9+: tells us what battery saver does to location; older: assume the worst.
        return Build.VERSION.SDK_INT < 28 || pm.locationPowerSaveMode != PowerManager.LOCATION_MODE_NO_CHANGE
    }

    fun settingsIntent(): Intent =
        Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    const val TITLE = "Battery saver is on"
    const val TEXT = "It turns GPS off when the screen is off, so this walk's route will have gaps. Turn battery saver off for the walk."
}
