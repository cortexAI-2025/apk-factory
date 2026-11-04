package com.apkfactory.reference;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Minimal, recognisable screen used to prove the ZIP → debug APK pipeline end to end. */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0B6E4F"));
        root.setPadding(48, 48, 48, 48);

        TextView title = new TextView(this);
        title.setText("APK Factory Reference OK");
        title.setTextSize(28f);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);
        title.setContentDescription("reference-title");

        TextView sub = new TextView(this);
        sub.setText("Built from a ZIP by APK Factory • debug v1.0");
        sub.setTextSize(16f);
        sub.setTextColor(Color.parseColor("#D8F3DC"));
        sub.setGravity(Gravity.CENTER);

        root.addView(title);
        root.addView(sub);
        setContentView(root);
    }
}
