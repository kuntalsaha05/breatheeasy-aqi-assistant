#!/usr/bin/env python3
"""Record the BreatheEasy 60-second demo video (GrowthX build video).

Scripted Playwright walkthrough of the app with a caption bar burned into
the recording itself (no ffmpeg text rendering needed). Run from the repo
root after starting a local server, e.g.:

    python3 -m http.server 8128 &
    ~/workspace/.pwenv/bin/python tools/record-video.py
    ffmpeg -i /tmp/breatheeasy-video/*.webm -c:v libx264 -pix_fmt yuv420p \
        ~/workspace/your_files/breatheeasy-demo-video.mp4

The video records the live app (index.html over HTTP), so it shows the
real interactions: plan generation, activity check, purifier sizing and
the dark-mode toggle. Total runtime is ~60 seconds.
"""
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:8128/index.html"
OUT_DIR = "/tmp/breatheeasy-video"
WIDTH, HEIGHT = 1280, 720

CAPTION_BAR_JS = """(text) => {
  let c = document.getElementById('vid-caption');
  if (!c) {
    c = document.createElement('div');
    c.id = 'vid-caption';
    c.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;'
      + 'pointer-events:none;background:rgba(15,23,42,.88);color:#fff;'
      + 'font:500 20px/1.4 system-ui,sans-serif;text-align:center;'
      + 'padding:14px 24px;border-top:3px solid #2dd4bf;';
    document.body.appendChild(c);
  }
  c.textContent = text;
}"""


def caption(page, text):
    page.evaluate(CAPTION_BAR_JS, text)


def scroll_to(page, selector):
    page.evaluate(
        "(sel) => document.querySelector(sel)"
        ".scrollIntoView({ behavior: 'smooth', block: 'start' })",
        selector,
    )
    time.sleep(1.2)


def main():
    t0 = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch(
            # The cached full Chromium (the headless shell is not downloaded).
            executable_path="/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
            args=["--hide-scrollbars", "--disable-gpu", "--no-sandbox"],
        )
        ctx = browser.new_context(
            viewport={"width": WIDTH, "height": HEIGHT},
            record_video_dir=OUT_DIR,
            record_video_size={"width": WIDTH, "height": HEIGHT},
        )
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1500)

        # 1 — AQI hero (5s)
        page.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })")
        caption(page, "BreatheEasy — an Urban Air Quality Assistant for Indian cities.")
        time.sleep(5)

        # 2 — Outlook charts (7s)
        scroll_to(page, "#outlook-card")
        caption(page, "Delhi today: AQI 420, Severe — and the cleanest air is 2–4 PM.")
        time.sleep(6)

        # 3 — City comparison (6s)
        scroll_to(page, "#compare-card")
        caption(page, "Fifteen cities ranked worst-first, so you can see where yours stands.")
        time.sleep(5)

        # 4 — Generate the day plan (8s)
        scroll_to(page, "#routine-card")
        page.locator("#p-children").check()
        page.locator("#p-asthma").check()
        caption(page, "Tell it your household — it builds a day plan where every choice states its impact.")
        page.locator("#generate").click()
        time.sleep(1.5)
        scroll_to(page, "#routine-list")
        time.sleep(5)

        # 5 — Impact summary (6s)
        scroll_to(page, "#impact-summary")
        caption(page, "Metro instead of the car: 5.5 kg of CO2 and ₹250 saved a week.")
        time.sleep(5)

        # 6 — Activity checker: running at 7 AM (8s)
        scroll_to(page, "#activity-card")
        page.locator("#act-activity").select_option("run")
        page.locator("#act-hour").select_option("7")
        caption(page, "Can I run at 7 AM? Let’s check.")
        page.locator("#act-check").click()
        time.sleep(1.0)
        scroll_to(page, "#act-result")
        caption(page, "No — about 1,000 µg of PM2.5 in one hour. Wait for the afternoon.")
        time.sleep(5)

        # 7 — Purifier sizer, then dark mode (8s)
        scroll_to(page, "#purifier-card")
        page.locator("#room-calc").click()
        time.sleep(1.0)
        caption(page, "Size a purifier for your room — this one needs 144 cubic metres an hour.")
        time.sleep(3.5)
        page.locator("#theme-toggle").click()
        caption(page, "And the whole app goes dark.")
        time.sleep(3)

        # 8 — Prompt Studio, end card (8s)
        scroll_to(page, "#prompt-card")
        caption(page, "Prompt Studio shows the exact prompt sent to Gemini. Built by Kuntal Saha, MIT-WPU.")
        time.sleep(7)

        video_path = page.video.path()
        ctx.close()
        browser.close()

    print(f"video: {video_path}")
    print(f"elapsed: {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
