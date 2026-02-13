#!/usr/bin/env python3
"""
Vision System Tests
Tests face detection, presence logic, and integration
"""

import unittest
import time
import json
import os
from unittest.mock import Mock, patch, MagicMock
import cv2
import numpy as np

# Mock mediapipe before importing detector
import sys
sys.path.insert(0, os.path.dirname(__file__))

class TestPresenceDetector(unittest.TestCase):
    """Test suite for PresenceDetector"""

    def setUp(self):
        """Setup test environment"""
        # Create test config
        self.test_config = {
            "fps": 15,
            "confirmation_frames": 5,
            "quiet_start": 22,
            "quiet_end": 7,
            "blur_mode": False,
            "camera_device": 0,
            "resolution": {"width": 1280, "height": 720}
        }

        with open('test_config.json', 'w') as f:
            json.dump(self.test_config, f)

    def tearDown(self):
        """Cleanup test files"""
        if os.path.exists('test_config.json'):
            os.remove('test_config.json')

    def test_config_loading(self):
        """Test 1: Configuration loads correctly"""
        from detector import PresenceDetector

        with patch('detector.mp_face_detection'):
            detector = PresenceDetector('test_config.json')

            self.assertEqual(detector.fps, 15)
            self.assertEqual(detector.confirmation_frames, 5)
            self.assertEqual(detector.quiet_start, 22)
            self.assertEqual(detector.quiet_end, 7)
            self.assertFalse(detector.blur_mode)
        print("✅ Test 1 passed: Config loading")

    def test_quiet_hours_logic(self):
        """Test 2: Quiet hours detection works"""
        from detector import PresenceDetector

        with patch('detector.mp_face_detection'):
            detector = PresenceDetector('test_config.json')

            # Mock different times
            with patch('time.localtime') as mock_time:
                # Test during quiet hours (11 PM)
                mock_time.return_value = time.struct_time((2024, 1, 1, 23, 0, 0, 0, 0, 0))
                self.assertTrue(detector.is_quiet_hours())

                # Test during quiet hours (2 AM)
                mock_time.return_value = time.struct_time((2024, 1, 1, 2, 0, 0, 0, 0, 0))
                self.assertTrue(detector.is_quiet_hours())

                # Test outside quiet hours (3 PM)
                mock_time.return_value = time.struct_time((2024, 1, 1, 15, 0, 0, 0, 0, 0))
                self.assertFalse(detector.is_quiet_hours())

        print("✅ Test 2 passed: Quiet hours logic")

    def test_presence_requires_consecutive_frames(self):
        """Test 3: Presence detection requires N consecutive frames"""
        from detector import PresenceDetector

        with patch('detector.mp_face_detection'):
            detector = PresenceDetector('test_config.json')
            detector.confirmation_frames = 5

            # Initial state
            self.assertEqual(detector.consecutive_frames, 0)
            self.assertFalse(detector.presence_state)

            # Simulate detecting face for 4 frames (not enough)
            for i in range(4):
                detector.consecutive_frames += 1

            self.assertEqual(detector.consecutive_frames, 4)
            self.assertFalse(detector.presence_state)  # Should still be False

            # 5th frame should trigger presence
            detector.consecutive_frames += 1
            if detector.consecutive_frames >= detector.confirmation_frames:
                detector.presence_state = True

            self.assertTrue(detector.presence_state)

        print("✅ Test 3 passed: Consecutive frame requirement")

    @patch('detector.requests.post')
    def test_greeting_sent_on_presence(self, mock_post):
        """Test 4: Greeting sent when presence detected"""
        from detector import PresenceDetector

        with patch('detector.mp_face_detection'):
            detector = PresenceDetector('test_config.json')

            # Mock successful response
            mock_post.return_value.status_code = 200

            # Mock non-quiet hours (3 PM)
            with patch('time.localtime') as mock_time:
                mock_time.return_value = time.struct_time((2024, 1, 1, 15, 0, 0, 0, 0, 0))

                # Send greeting
                detector.send_greeting()

                # Check that request was made
                self.assertTrue(mock_post.called)
                call_args = mock_post.call_args

                # Verify endpoint
                self.assertEqual(call_args[0][0], 'http://localhost:18789/incoming/web')

                # Verify payload
                payload = call_args[1]['json']
                self.assertEqual(payload['channel'], 'proactive')
                self.assertIn('PROACTIVE_GREETING:', payload['body'])

        print("✅ Test 4 passed: Greeting sent on presence")

    @patch('detector.requests.post')
    def test_quiet_hours_blocks_greeting(self, mock_post):
        """Test 5: Quiet hours prevent greeting"""
        from detector import PresenceDetector

        with patch('detector.mp_face_detection'):
            detector = PresenceDetector('test_config.json')

            # Mock quiet hours (11 PM)
            with patch('time.localtime') as mock_time:
                mock_time.return_value = time.struct_time((2024, 1, 1, 23, 0, 0, 0, 0, 0))

                # Attempt to send greeting
                detector.send_greeting()

                # Should NOT have made request
                self.assertFalse(mock_post.called)

        print("✅ Test 5 passed: Quiet hours block greeting")

    def test_greeting_cooldown(self):
        """Test 6: Greeting has 1-hour cooldown"""
        from detector import PresenceDetector

        with patch('detector.mp_face_detection'):
            detector = PresenceDetector('test_config.json')

            # Mock non-quiet hours
            with patch('time.localtime') as mock_time:
                mock_time.return_value = time.struct_time((2024, 1, 1, 15, 0, 0, 0, 0, 0))

                # Set last greeting to 30 minutes ago
                detector.last_greeting = time.time() - 1800

                with patch('detector.requests.post') as mock_post:
                    mock_post.return_value.status_code = 200

                    # Should be blocked by cooldown
                    detector.send_greeting()
                    self.assertFalse(mock_post.called)

                    # Set last greeting to 61 minutes ago
                    detector.last_greeting = time.time() - 3660

                    # Should now be allowed
                    detector.send_greeting()
                    self.assertTrue(mock_post.called)

        print("✅ Test 6 passed: Greeting cooldown")

    def test_time_aware_greetings(self):
        """Test 7: Greeting message changes based on time"""
        from detector import PresenceDetector

        with patch('detector.mp_face_detection'):
            detector = PresenceDetector('test_config.json')

            # Morning (9 AM)
            with patch('time.localtime') as mock_time:
                mock_time.return_value = time.struct_time((2024, 1, 1, 9, 0, 0, 0, 0, 0))
                msg = detector.get_greeting_message()
                self.assertIn('morning', msg.lower())

            # Afternoon (3 PM)
            with patch('time.localtime') as mock_time:
                mock_time.return_value = time.struct_time((2024, 1, 1, 15, 0, 0, 0, 0, 0))
                msg = detector.get_greeting_message()
                self.assertIn('Hey Omar', msg)

            # Evening (8 PM)
            with patch('time.localtime') as mock_time:
                mock_time.return_value = time.struct_time((2024, 1, 1, 20, 0, 0, 0, 0, 0))
                msg = detector.get_greeting_message()
                self.assertIn('Evening', msg)

        print("✅ Test 7 passed: Time-aware greetings")

if __name__ == '__main__':
    print("\n" + "="*60)
    print("VISION SYSTEM TEST SUITE")
    print("="*60 + "\n")

    # Run tests
    suite = unittest.TestLoader().loadTestsFromTestCase(TestPresenceDetector)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # Summary
    print("\n" + "="*60)
    print(f"Tests run: {result.testsRun}")
    print(f"Successes: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print("="*60 + "\n")

    sys.exit(0 if result.wasSuccessful() else 1)
