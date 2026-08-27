const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

const signToken = (user, roleName) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: roleName },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const safeRole = ['admin', 'conductor', 'passenger'].includes(role) ? role : 'conductor';
    const roleRecord = await prisma.role.findUnique({ where: { name: safeRole } });
    if (!roleRecord) {
      return res.status(500).json({ message: 'Role not found in database' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        roleId: roleRecord.id,
      },
      include: { role: true }
    });

    const token = signToken(user, user.role.name);

    return res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role.name },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to register user' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true }
    });
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = signToken(user, user.role.name);
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role.name },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to login user' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { role: true }
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const { password, ...userWithoutPassword } = user;
    return res.json({ user: { ...userWithoutPassword, role: user.role.name } });
  } catch(error) {
    return res.status(500).json({ message: 'Failed to fetch user' });
  }
});

router.get('/admin', auth, requireRole('admin'), (req, res) => {
  return res.json({ message: 'Admin access granted' });
});

module.exports = router;
