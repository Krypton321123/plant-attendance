import { Request, Response } from 'express';
import prisma from '../util/prisma';

// ────────────────────────────────────────────────────────────────────────
// Portal user management — the people who log into this web app itself.
//
// Passwords are stored and compared in plaintext, per explicit request.
// This is a soft gate for an internal tool, not a security boundary — see
// the comment block above the PortalUser model in schema.prisma.
//
// There is no token/session issuance here. `login` just verifies the
// credentials and hands back the user's profile + allowed screens; the
// frontend AuthContext stores that in localStorage and re-sends
// username/password (or just trusts the stored profile) on subsequent
// requests, matching the existing hardcoded-admin pattern this replaces.
// ────────────────────────────────────────────────────────────────────────

const VALID_SCREEN_KEYS = ['dashboard', 'attendance', 'payroll'];

function sanitize(user: {
  USER_ID: string;
  USERNAME: string;
  DISPLAY_NAME: string;
  IS_SUPER: boolean;
  ALLOWED_SCREENS: string;
  CREATEDAT: Date;
}) {
  // Never send PASSWORD back to the client, in any endpoint, ever.
  let allowedScreens: string[] = [];
  try {
    allowedScreens = JSON.parse(user.ALLOWED_SCREENS);
    if (!Array.isArray(allowedScreens)) allowedScreens = [];
  } catch {
    allowedScreens = [];
  }
  return {
    id: user.USER_ID,
    username: user.USERNAME,
    displayName: user.DISPLAY_NAME,
    isSuper: user.IS_SUPER,
    // Super users bypass this list entirely — see login() and the schema
    // comment — but we still return their stored value as-is for the edit
    // form to prefill from, rather than silently rewriting it to "all".
    allowedScreens,
    createdAt: user.CREATEDAT,
  };
}

function validateScreenKeys(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const cleaned = input.filter((k) => typeof k === 'string');
  if (cleaned.some((k) => !VALID_SCREEN_KEYS.includes(k))) return null;
  return cleaned;
}

export async function portalLogin(req: Request, res: Response) {
    console.log("reached here")
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = await prisma.portalUser.findUnique({
    where: { USERNAME: username.trim() },
  });

  if (!user || user.PASSWORD !== password) {
    // Same message either way — don't leak whether the username exists.
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  return res.json({ user: sanitize(user) });
}

export async function getAllPortalUsers(_req: Request, res: Response) {
  const users = await prisma.portalUser.findMany({ orderBy: { CREATEDAT: 'asc' } });
  return res.json({ users: users.map(sanitize) });
}

export async function createPortalUser(req: Request, res: Response) {
  const { username, password, displayName, isSuper, allowedScreens } = req.body ?? {};

  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'password is required' });
  }
  if (typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ error: 'displayName is required' });
  }

  const cleanedScreens = validateScreenKeys(allowedScreens ?? []);
  if (cleanedScreens === null) {
    return res.status(400).json({ error: `allowedScreens must be an array of valid screen keys: ${VALID_SCREEN_KEYS.join(', ')}` });
  }

  const existing = await prisma.portalUser.findUnique({ where: { USERNAME: username.trim() } });
  if (existing) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  const created = await prisma.portalUser.create({
    data: {
      USERNAME: username.trim(),
      PASSWORD: password,
      DISPLAY_NAME: displayName.trim(),
      IS_SUPER: Boolean(isSuper),
      ALLOWED_SCREENS: JSON.stringify(cleanedScreens),
    },
  });

  return res.status(201).json({ user: sanitize(created) });
}

export async function updatePortalUser(req: Request, res: Response) {
  const { userId } = req.params;
  const { password, displayName, isSuper, allowedScreens } = req.body ?? {};

  const existing = await prisma.portalUser.findUnique({ where: { USER_ID: userId as string } });
  if (!existing) {
    return res.status(404).json({ error: 'Portal user not found' });
  }

  // Guard: the hardcoded 'admin' super user must always stay a super user,
  // so nobody can accidentally strip access from the one account that's
  // guaranteed to be able to fix things. Other super users CAN be demoted.
  if (existing.USERNAME === 'admin' && isSuper === false) {
    return res.status(400).json({ error: "The 'admin' account cannot be demoted from super user" });
  }

  const data: Record<string, unknown> = {};

  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ error: 'displayName cannot be empty' });
    }
    data.DISPLAY_NAME = displayName.trim();
  }

  if (password !== undefined) {
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'password cannot be empty' });
    }
    data.PASSWORD = password;
  }

  if (isSuper !== undefined) {
    data.IS_SUPER = Boolean(isSuper);
  }

  if (allowedScreens !== undefined) {
    const cleanedScreens = validateScreenKeys(allowedScreens);
    if (cleanedScreens === null) {
      return res.status(400).json({ error: `allowedScreens must be an array of valid screen keys: ${VALID_SCREEN_KEYS.join(', ')}` });
    }
    data.ALLOWED_SCREENS = JSON.stringify(cleanedScreens);
  }

  const updated = await prisma.portalUser.update({ where: { USER_ID: userId as string }, data });
  return res.json({ user: sanitize(updated) });
}

export async function deletePortalUser(req: Request, res: Response) {
  const { userId } = req.params;

  const existing = await prisma.portalUser.findUnique({ where: { USER_ID: userId as string } });
  if (!existing) {
    return res.status(404).json({ error: 'Portal user not found' });
  }
  if (existing.USERNAME === 'admin') {
    return res.status(400).json({ error: "The 'admin' account cannot be deleted" });
  }

  await prisma.portalUser.delete({ where: { USER_ID: userId as string } });
  return res.status(204).send();
}

