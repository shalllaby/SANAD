const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { verifyApiKey } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// AI INTEGRATION ENDPOINTS
// All endpoints require X-API-Key header for external service authentication.
// These are PLACEHOLDERS — the actual AI logic will be implemented by the AI team.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/integrations/fall-detection
 * Called by the Computer Vision / Fall Detection AI service.
 *
 * Request body:
 * {
 *   "elderId": "uuid",
 *   "confidence": 0.95,        // 0.0 - 1.0
 *   "location": "living room", // optional
 *   "imageUrl": "...",         // optional, pre-signed URL
 *   "timestamp": "ISO string"  // optional
 * }
 */
router.post('/fall-detection', verifyApiKey, async (req, res) => {
    try {
        const { elderId, confidence, location, imageUrl, timestamp } = req.body;

        if (!elderId) {
            return res.status(400).json({ error: 'elderId مطلوب' });
        }

        // Verify elder exists
        const elder = await prisma.user.findUnique({
            where: { id: elderId, role: 'ELDER' },
            select: { id: true, name: true }
        });
        if (!elder) return res.status(404).json({ error: 'كبير السن مش موجود' });

        // Create alert
        const alert = await prisma.alert.create({
            data: {
                elderId,
                type: 'FALL',
                message: `تم اكتشاف سقوط${location ? ` في ${location}` : ''}! ${confidence ? `(دقة: ${(confidence * 100).toFixed(0)}%)` : ''}`,
                severity: confidence && confidence > 0.85 ? 'CRITICAL' : 'HIGH',
                source: 'FALL_DETECTION',
                metadata: JSON.stringify({ confidence, location, imageUrl, timestamp: timestamp || new Date().toISOString() })
            }
        });

        console.log(`🚨 Fall Detected for ${elder.name}: confidence=${confidence}`);

        res.json({
            message: 'تم استلام بيانات كشف السقوط',
            alertId: alert.id,
            processed: true
        });
    } catch (err) {
        console.error('Fall detection integration error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

/**
 * POST /api/integrations/mood-detection
 * Called by the Mood/Emotion Detection AI service.
 *
 * Request body:
 * {
 *   "elderId": "uuid",
 *   "mood": "SAD",           // HAPPY | SAD | ANGRY | CALM | ANXIOUS | CONFUSED
 *   "score": 7.5,            // mood intensity 0-10
 *   "confidence": 0.88,
 *   "recommendAlert": true,  // whether to trigger an alert
 *   "timestamp": "ISO string"
 * }
 */
router.post('/mood-detection', verifyApiKey, async (req, res) => {
    try {
        const { elderId, mood, score, confidence, recommendAlert, timestamp } = req.body;

        if (!elderId || !mood) {
            return res.status(400).json({ error: 'elderId و mood مطلوبين' });
        }

        const elder = await prisma.user.findUnique({
            where: { id: elderId, role: 'ELDER' },
            select: { id: true, name: true }
        });
        if (!elder) return res.status(404).json({ error: 'كبير السن مش موجود' });

        // Store health data
        await prisma.healthData.create({
            data: {
                elderId,
                moodScore: score || null,
                moodLabel: mood,
                source: 'MOOD_DETECTION',
                recordedAt: timestamp ? new Date(timestamp) : new Date()
            }
        });

        // Create alert only if recommended or mood is critically bad
        let alert = null;
        const criticalMoods = ['SAD', 'ANXIOUS', 'CONFUSED'];
        if (recommendAlert || (criticalMoods.includes(mood) && score && score > 6)) {
            const moodLabels = {
                SAD: 'حزين', ANGRY: 'غاضب', ANXIOUS: 'قلقان', CONFUSED: 'مرتبك',
                HAPPY: 'سعيد', CALM: 'هادئ'
            };
            alert = await prisma.alert.create({
                data: {
                    elderId,
                    type: 'MOOD',
                    message: `كبير السن يبدو ${moodLabels[mood] || mood} — يُستحسن التواصل معه`,
                    severity: criticalMoods.includes(mood) ? 'MEDIUM' : 'LOW',
                    source: 'MOOD_DETECTION',
                    metadata: JSON.stringify({ mood, score, confidence, timestamp })
                }
            });
        }

        res.json({
            message: 'تم استلام بيانات الحالة المزاجية',
            alertCreated: !!alert,
            alertId: alert?.id
        });
    } catch (err) {
        console.error('Mood detection integration error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

/**
 * POST /api/integrations/health-prediction
 * Called by the Health Prediction / Anomaly Detection AI service.
 *
 * Request body:
 * {
 *   "elderId": "uuid",
 *   "heartRate": 95,
 *   "bloodPressure": "140/90",
 *   "bloodOxygen": 94.5,
 *   "steps": 234,
 *   "riskLevel": "HIGH",      // LOW | MEDIUM | HIGH | CRITICAL
 *   "riskFactors": ["high_bp", "low_oxygen"],
 *   "recommendation": "...",
 *   "timestamp": "ISO string"
 * }
 */
router.post('/health-prediction', verifyApiKey, async (req, res) => {
    try {
        const { elderId, heartRate, bloodPressure, bloodOxygen, steps, riskLevel, riskFactors, recommendation, timestamp } = req.body;

        if (!elderId) {
            return res.status(400).json({ error: 'elderId مطلوب' });
        }

        const elder = await prisma.user.findUnique({
            where: { id: elderId, role: 'ELDER' },
            select: { id: true, name: true }
        });
        if (!elder) return res.status(404).json({ error: 'كبير السن مش موجود' });

        // Store vitals
        await prisma.healthData.create({
            data: {
                elderId,
                heartRate: heartRate || null,
                bloodPressure: bloodPressure || null,
                bloodOxygen: bloodOxygen || null,
                steps: steps || null,
                source: 'HEALTH_PREDICTION',
                recordedAt: timestamp ? new Date(timestamp) : new Date()
            }
        });

        // Create alert for concerning risk levels
        let alert = null;
        if (riskLevel && ['HIGH', 'CRITICAL'].includes(riskLevel)) {
            alert = await prisma.alert.create({
                data: {
                    elderId,
                    type: 'HEALTH',
                    message: `تحذير صحي: ${recommendation || 'يُوصى بالمراجعة الطبية'} — مستوى الخطر: ${riskLevel}`,
                    severity: riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
                    source: 'HEALTH_PREDICTION',
                    metadata: JSON.stringify({ heartRate, bloodPressure, bloodOxygen, riskLevel, riskFactors, steps })
                }
            });
        }

        res.json({
            message: 'تم استلام البيانات الصحية',
            alertCreated: !!alert,
            alertId: alert?.id
        });
    } catch (err) {
        console.error('Health prediction integration error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

/**
 * POST /api/integrations/chatbot
 * Dedicated endpoint for the SANAD AI chatbot service to push responses.
 *
 * Request body:
 * {
 *   "userId": "uuid",
 *   "reply": "...",           // bot's response text
 *   "sessionId": "...",       // optional session tracking
 *   "confidence": 0.9,
 *   "intent": "medication_reminder"
 * }
 */
router.post('/chatbot', verifyApiKey, async (req, res) => {
    try {
        const { userId, reply, sessionId, confidence, intent } = req.body;

        if (!userId || !reply) {
            return res.status(400).json({ error: 'userId و reply مطلوبين' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true }
        });
        if (!user) return res.status(404).json({ error: 'المستخدم مش موجود' });

        // Store bot message
        const botMessage = await prisma.chatMessage.create({
            data: {
                userId,
                role: 'BOT',
                content: reply
            }
        });

        res.json({
            message: 'تم استلام رد سناد',
            botMessageId: botMessage.id
        });
    } catch (err) {
        console.error('Chatbot integration error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
