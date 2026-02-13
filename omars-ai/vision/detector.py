#!/usr/bin/env python3
"""
Vision System - Desk Presence Detection
Detects when Omar sits at desk and triggers greeting
"""

import cv2
import mediapipe as mp
import time
import json
import requests
from typing import Optional, Tuple
import sys

# MediaPipe Face Detection
mp_face_detection = mp.solutions.face_detection
mp_drawing = mp.solutions.drawing_utils

class PresenceDetector:
    def __init__(self, config_path: str = 'config.json'):
        self.load_config(config_path)
        self.face_detection = mp_face_detection.FaceDetection(
            model_selection=0,  # 0 for short-range (< 2m), 1 for long-range
            min_detection_confidence=0.5
        )
        self.consecutive_frames = 0
        self.presence_state = False
        self.last_greeting = 0
        self.GREETING_COOLDOWN = 3600  # 1 hour
        self.frame_count = 0
        self.last_frame_send = 0
        self.FRAME_SEND_INTERVAL = 0.5  # Send frame every 500ms to reduce bandwidth

    def load_config(self, config_path: str) -> None:
        """Load configuration from JSON file"""
        try:
            with open(config_path) as f:
                config = json.load(f)
                self.fps = config.get('fps', 15)
                self.confirmation_frames = config.get('confirmation_frames', 5)
                self.quiet_start = config.get('quiet_start', 22)  # 10 PM
                self.quiet_end = config.get('quiet_end', 7)  # 7 AM
                self.blur_mode = config.get('blur_mode', False)
                self.camera_device = config.get('camera_device', 0)
                self.resolution = config.get('resolution', {'width': 1280, 'height': 720})
                print(f"[VISION] Config loaded: {self.fps} FPS, blur={self.blur_mode}")
        except Exception as e:
            print(f"[VISION] Config load failed ({e}), using defaults")
            # Defaults
            self.fps = 15
            self.confirmation_frames = 5
            self.quiet_start = 22
            self.quiet_end = 7
            self.blur_mode = False
            self.camera_device = 0
            self.resolution = {'width': 1280, 'height': 720}

    def is_quiet_hours(self) -> bool:
        """Check if current time is in quiet hours"""
        hour = time.localtime().tm_hour
        if self.quiet_start > self.quiet_end:  # Crosses midnight
            return hour >= self.quiet_start or hour < self.quiet_end
        return self.quiet_start <= hour < self.quiet_end

    def detect_face(self, frame) -> bool:
        """Detect if face is present in frame"""
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_detection.process(rgb_frame)

        if results.detections:
            # Draw detection box (for debugging)
            if not self.blur_mode:  # Only draw if not in privacy mode
                for detection in results.detections:
                    mp_drawing.draw_detection(frame, detection)
            return True
        return False

    def get_greeting_message(self) -> str:
        """Generate time-aware greeting message"""
        hour = time.localtime().tm_hour
        if hour < 12:
            return "Good morning! ☀️ What can I tackle for you today?"
        elif hour < 18:
            return "Hey Omar! 👋 Ready to help with anything."
        else:
            return "Evening! 🌙 What are we working on?"

    def send_greeting(self) -> None:
        """Send proactive greeting via Gateway"""
        now = time.time()

        # Check cooldown
        if now - self.last_greeting < self.GREETING_COOLDOWN:
            print(f"[VISION] Greeting on cooldown ({int((self.GREETING_COOLDOWN - (now - self.last_greeting)) / 60)} min remaining)")
            return

        # Check quiet hours
        if self.is_quiet_hours():
            print(f"[VISION] Quiet hours ({self.quiet_start}:00-{self.quiet_end}:00), skipping greeting")
            return

        message = self.get_greeting_message()

        # Send via Gateway SMS route (localhost:18789)
        try:
            response = requests.post(
                'http://localhost:18789/incoming/web',
                json={
                    'userId': 'omar',  # TODO: Get from env or config
                    'username': 'omar',
                    'channel': 'proactive',
                    'from': 'vision_system',
                    'body': f'PROACTIVE_GREETING: {message}'
                },
                timeout=5
            )

            if response.status_code == 200:
                print(f"[VISION] ✅ Greeting sent: {message}")
                self.last_greeting = now
            else:
                print(f"[VISION] ⚠️  Failed to send greeting: HTTP {response.status_code}")
        except requests.exceptions.ConnectionError:
            print(f"[VISION] ⚠️  Gateway not reachable (localhost:18789)")
        except Exception as e:
            print(f"[VISION] ⚠️  Error sending greeting: {e}")

    def send_frame(self, frame) -> None:
        """Send frame to WebSocket server"""
        now = time.time()

        # Throttle frame sending to reduce bandwidth
        if now - self.last_frame_send < self.FRAME_SEND_INTERVAL:
            return

        # Encode frame as JPEG (80% quality for bandwidth)
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])

        # Send to camera-service
        try:
            response = requests.post(
                'http://localhost:3004/frame',
                data=buffer.tobytes(),
                headers={'Content-Type': 'image/jpeg'},
                timeout=1
            )
            self.last_frame_send = now
        except Exception:
            # Silent fail - don't spam logs with network errors
            pass

    def send_presence_update(self, present: bool) -> None:
        """Send presence update to WebSocket server"""
        try:
            response = requests.post(
                'http://localhost:3004/presence',
                json={'present': present},
                timeout=1
            )
            if response.status_code == 200:
                print(f"[VISION] 📡 Presence broadcasted: {present}")
        except Exception as e:
            print(f"[VISION] ⚠️  Failed to send presence: {e}")

    def run(self) -> None:
        """Main detection loop"""
        cap = cv2.VideoCapture(self.camera_device)

        if not cap.isOpened():
            print(f"[VISION] ❌ Failed to open camera device {self.camera_device}")
            sys.exit(1)

        # Set camera properties
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.resolution['width'])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.resolution['height'])
        cap.set(cv2.CAP_PROP_FPS, self.fps)

        actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        actual_fps = int(cap.get(cv2.CAP_PROP_FPS))

        print(f"[VISION] 🎥 Camera opened: {actual_width}x{actual_height} @ {actual_fps} FPS")
        print(f"[VISION] 🔒 Blur mode: {self.blur_mode}")
        print(f"[VISION] 🌙 Quiet hours: {self.quiet_start}:00 - {self.quiet_end}:00")
        print(f"[VISION] ✅ Confirmation frames: {self.confirmation_frames}")
        print(f"[VISION] ⏱️  Greeting cooldown: {self.GREETING_COOLDOWN / 60} min")
        print("[VISION] 🚀 Starting presence detection...")

        frame_delay = 1.0 / self.fps

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    print("[VISION] ⚠️  Failed to read frame")
                    time.sleep(1)
                    continue

                self.frame_count += 1

                # Detect face
                face_present = self.detect_face(frame)

                # State machine: require N consecutive frames for confirmation
                if face_present:
                    self.consecutive_frames += 1

                    if self.consecutive_frames >= self.confirmation_frames:
                        if not self.presence_state:
                            # State transition: absent → present
                            print(f"[VISION] ✅ PRESENCE DETECTED (frame {self.frame_count})")
                            self.presence_state = True
                            self.send_greeting()
                            self.send_presence_update(True)
                else:
                    if self.consecutive_frames > 0:
                        self.consecutive_frames -= 1

                    if self.consecutive_frames == 0 and self.presence_state:
                        # State transition: present → absent
                        print(f"[VISION] ❌ PRESENCE LOST (frame {self.frame_count})")
                        self.presence_state = False
                        self.send_presence_update(False)

                # Apply blur if privacy mode enabled
                if self.blur_mode:
                    frame = cv2.GaussianBlur(frame, (99, 99), 30)

                # Send frame to WebSocket server (throttled)
                self.send_frame(frame)

                # Debug output every 100 frames
                if self.frame_count % 100 == 0:
                    status = "PRESENT ✅" if self.presence_state else "ABSENT ❌"
                    print(f"[VISION] Frame {self.frame_count}: {status} (consecutive: {self.consecutive_frames})")

                time.sleep(frame_delay)

        except KeyboardInterrupt:
            print("\n[VISION] 🛑 Stopping detector...")
        finally:
            cap.release()
            print("[VISION] 👋 Camera released")

if __name__ == '__main__':
    print("[VISION] 🚀 Initializing presence detector...")
    detector = PresenceDetector()
    detector.run()
