from pathlib import Path
import cv2
from ultralytics import YOLO
def find_capture_source():
    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        ok, _ = cap.read()
        cap.release()
        if ok:
            return 0
    fallback_files = [
        Path(__file__).resolve().parent / 'sample.mp4',
        Path(__file__).resolve().parent / 'sample.avi',
        Path(__file__).resolve().parent / 'demo.mp4',
    ]
    for candidate in fallback_files:
        if candidate.exists():
            return str(candidate)
    return None
def main():
    source = find_capture_source()
    if source is None:
        print('YOLO could not find a webcam or a local sample video. Please connect a camera and launch again.')
        return 1
    model = YOLO('yolov8n.pt')
    print(f'Starting YOLO on: {source}')
    model.predict(source=0, save=True, show=True)
    return 0
if __name__ == '__main__':
    raise SystemExit(main())
