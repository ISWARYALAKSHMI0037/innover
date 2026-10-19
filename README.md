# VisionAI Project Hub

A local hub for launching the four projects in this folder: YOLO Object Detection, Sign Speak, OfferCheck, and Expression Studio.

## First-time setup (Windows)

Install Node.js 22 LTS and Python 3 first. In PowerShell, install the project dependencies once:

```powershell
cd "C:\path\to\offercheck\offercheck"
npm run install:all
cd "..\sign speak"
npm install
cd "..\emotion studio"
npm install
cd ".."
py -m pip install ultralytics opencv-python
```

Then double-click `start-hub.bat`, or from this folder run `node launcher.js` and open <http://127.0.0.1:4170>. Launch only the project you want from the hub; its project tab opens directly.

- **YOLO Object Detection** starts `1.py` with `py -3`.
- **Sign Speak** recognizes finger counts 1–10 across one or two hands and a palms-together greeting in its default mode. The separate prototype and trained-model modes remain available.
- **OfferCheck** starts its API and Vite development server. It may also need MongoDB and the configuration described in [offercheck/README.md](./offercheck/README.md).
- **Expression Studio** estimates visible facial-expression cues for up to six people. It is not a stress or mental-health detector. Video is processed locally and not saved; stop the camera or close its tab to end the camera session and stop its hub-launched dev server.

The hub binds only to `127.0.0.1`; its launch controls are intended for use on this machine. Camera projects require browser permission and a working webcam.
