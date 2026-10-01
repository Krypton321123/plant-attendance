import { useEffect, useState } from 'react';
import { Trash2, Pencil, Plus, X, ShieldCheck } from 'lucide-react';
import { SCREENS } from './Auth/screens';
import { apiUrl } from './Auth/apiconfig';

// ────────────────────────────────────────────────────────────────────────
// User Management — create portal users and assign them access to specific
// screens. Only reachable by isSuper users (see App.tsx's SuperOnlyRoute
// and Sidebar.tsx's conditional nav link) — but every mutation here ALSO
// hits an endpoint that itself should be checking the caller is super
// server-side. This component does not re-implement that check; it trusts
// the route guard got it right and focuses on the CRUD UI.
//
// No password hashing, no tokens — matches the rest of this app's current
// auth approach. See the comment block atop Auth/AuthContext.tsx.
// ────────────────────────────────────────────────────────────────────────

interface PortalUserRow {
  id: string;
  username: string;
  displayName: string;
  isSuper: boolean;
  allowedScreens: string[];
}

interface FormState {
  username: string;
  password: string;
  displayName: string;
  isSuper: boolean;
  allowedScreens: string[];
}

const EMPTY_FORM: FormState = {
  username: '',
  password: '',
  displayName: '',
  isSuper: false,
  allowedScreens: [],
};

export default function UserManagement() {
  const [users, setUsers] = useState<PortalUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = form closed. 'new' = creating. A user id = editing that user.
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/portal-users'));
      if (!res.ok) throw new Error('Failed to load users');
      const body = await res.json();
      setUsers(body.users);
    } catch {
      setError('Could not load users. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditingId('new');
  }

  function openEdit(u: PortalUserRow) {
    setForm({
      username: u.username,
      password: '', // blank = "don't change" on edit; see submit handler
      displayName: u.displayName,
      isSuper: u.isSuper,
      allowedScreens: u.allowedScreens,
    });
    setFormError(null);
    setEditingId(u.id);
  }

  function closeForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function toggleScreen(key: string) {
    setForm((f) => ({
      ...f,
      allowedScreens: f.allowedScreens.includes(key)
        ? f.allowedScreens.filter((k) => k !== key)
        : [...f.allowedScreens, key],
    }));
  }

  async function handleSubmit(e: any) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setFormError(null);

    try {
      if (editingId === 'new') {
        const res = await fetch(apiUrl('/portal-users'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: form.username,
            password: form.password,
            displayName: form.displayName,
            isSuper: form.isSuper,
            allowedScreens: form.allowedScreens,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? 'Failed to create user');
        }
      } else {
        // On edit, password is optional — omit it entirely rather than
        // sending an empty string, so the backend knows "leave unchanged"
        // vs. "set to empty" (the controller only touches PASSWORD when
        // the field is present in the body at all).
        const payload: Record<string, unknown> = {
          displayName: form.displayName,
          isSuper: form.isSuper,
          allowedScreens: form.allowedScreens,
        };
        if (form.password) payload.password = form.password;

        const res = await fetch(apiUrl(`/portal-users/${editingId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? 'Failed to update user');
        }
      }

      closeForm();
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(u: PortalUserRow) {
    if (u.username === 'admin') return; // backend blocks it too; UI just doesn't offer it
    if (!confirm(`Delete user "${u.displayName}" (${u.username})? This can't be undone.`)) {
      return;
    }
    try {
      const res = await fetch(apiUrl(`/portal-users/${u.id}`), { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to delete user');
      }
      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">User Management</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            Create portal users and choose which screens each one can see.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-zinc-800"
        >
          <Plus size={15} />
          New user
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-[13px] text-zinc-400">Loading users…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Username</th>
                <th className="px-4 py-2.5 font-medium">Access</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-3 font-medium text-zinc-800">{u.displayName}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-zinc-500">{u.username}</td>
                  <td className="px-4 py-3">
                    {u.isSuper ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">
                        <ShieldCheck size={11} />
                        Full access
                      </span>
                    ) : u.allowedScreens.length === 0 ? (
                      <span className="text-[12px] text-zinc-400">No screens assigned</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.allowedScreens.map((key) => {
                          const s = SCREENS.find((sc) => sc.key === key);
                          return (
                            <span
                              key={key}
                              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
                            >
                              {s?.label ?? key}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                        aria-label={`Edit ${u.displayName}`}
                      >
                        <Pencil size={14} />
                      </button>
                      {u.username !== 'admin' && (
                        <button
                          onClick={() => handleDelete(u)}
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Delete ${u.displayName}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create / edit panel ── */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-zinc-900">
                {editingId === 'new' ? 'New user' : 'Edit user'}
              </h2>
              <button
                onClick={closeForm}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-zinc-600">
                  Display name
                </label>
                <input
                  type="text"
                  required
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] outline-none focus:border-zinc-400"
                  placeholder="e.g. Priya Sharma"
                />
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-medium text-zinc-600">
                  Username
                </label>
                <input
                  type="text"
                  required
                  disabled={editingId !== 'new'}
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] outline-none focus:border-zinc-400 disabled:bg-zinc-50 disabled:text-zinc-400"
                  placeholder="e.g. priya.s"
                />
                {editingId !== 'new' && (
                  <p className="mt-1 text-[11px] text-zinc-400">Username can't be changed after creation.</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-medium text-zinc-600">
                  {editingId === 'new' ? 'Password' : 'New password (leave blank to keep current)'}
                </label>
                <input
                  type="text"
                  required={editingId === 'new'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] outline-none focus:border-zinc-400"
                  placeholder={editingId === 'new' ? 'Choose a password' : '••••••••'}
                />
              </div>

              <label className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={form.isSuper}
                  disabled={form.username === 'admin'}
                  onChange={(e) => setForm((f) => ({ ...f, isSuper: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-zinc-300"
                />
                <span className="text-[13px] text-zinc-700">
                  Super user <span className="text-zinc-400">(full access to every screen, can't be restricted)</span>
                </span>
              </label>

              {!form.isSuper && (
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-600">
                    Screen access
                  </label>
                  <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-2.5">
                    {SCREENS.map((s) => (
                      <label key={s.key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.allowedScreens.includes(s.key)}
                          onChange={() => toggleScreen(s.key)}
                          className="h-3.5 w-3.5 rounded border-zinc-300"
                        />
                        <span className="text-[13px] text-zinc-700">{s.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {formError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                  {formError}
                </div>
              )}

              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editingId === 'new' ? 'Create user' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}