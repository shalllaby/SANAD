const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Middleware: Verify JWT token from Authorization header.
 * Attaches req.user = { id, email, role, name } if valid.
 */
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'غير مصرح — يرجى تسجيل الدخول أولاً' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, name: true, email: true, role: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'المستخدم غير موجود' });
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'انتهت صلاحية الجلسة — يرجى تسجيل الدخول مجدداً' });
        }
        return res.status(401).json({ error: 'رمز غير صالح' });
    }
};

/**
 * Middleware: Require specific role(s).
 * Usage: requireRole('MONITOR') or requireRole(['MONITOR', 'ADMIN'])
 */
const requireRole = (roles) => {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return (req, res, next) => {
        if (!req.user || !allowed.includes(req.user.role)) {
            return res.status(403).json({ error: 'غير مصرح لك بهذا الإجراء' });
        }
        next();
    };
};

/**
 * Middleware: Verify external AI service API key.
 * Checks X-API-Key header against EXTERNAL_API_KEY env var.
 */
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.EXTERNAL_API_KEY) {
        return res.status(401).json({ error: 'مفتاح API غير صالح' });
    }
    next();
};

module.exports = { authenticate, requireRole, verifyApiKey };
