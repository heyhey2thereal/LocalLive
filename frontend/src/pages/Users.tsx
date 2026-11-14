import { useCallback, useEffect, useState } from 'react'
import { api, type Catalog } from '../api'
import { ConfirmDialog, EmptyState, Loading, Modal, useToast } from '../components/ui'
import { IconEdit, IconPlus, IconTrash } from '../components/icons'

interface ManagedUser {
  id: number
  username: string
  role: string
  is_admin: boolean
  permissions: string[]
  created_at: string
  last_login: string | null
}

interface Draft {
  id?: number
  username: string
  password: string
  role: string
  permissions: string[]
}

const EMPTY: Draft = { username: '', password: '', role: 'viewer', permissions: [] }

export default function Users() {
  const { push } = useToast()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [toDelete, setToDelete] = useState<ManagedUser | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, c] = await Promise.all([
        api.get<{ items: ManagedUser[] }>('/api/users'),
        api.get<Catalog>('/api/meta/catalog').catch(() => null),
      ])
      setUsers(u.items)
      setCatalog(c)
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const roleLabel = (id: string) => catalog?.roles?.find((r) => r.id === id)?.label ?? id

  const save = async () => {
    if (!draft) return
    if (!draft.username.trim()) return push({ kind: 'err', title: "Le nom d'utilisateur est requis" })
    if (!draft.id && draft.password.length < 8) return push({ kind: 'err', title: 'Mot de passe trop court (8 min.)' })
    try {
      const payload: Record<string, unknown> = {
        username: draft.username,
        role: draft.role,
        permissions: draft.permissions,
      }
      if (draft.password) payload.password = draft.password
      if (draft.id) await api.patch(`/api/users/${draft.id}`, payload)
      else await api.post('/api/users', payload)
      push({ kind: 'ok', title: 'Utilisateur enregistré' })
      setDraft(null)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Enregistrement impossible', message: err?.message })
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await api.del(`/api/users/${toDelete.id}`)
      setToDelete(null)
      await load()
      push({ kind: 'ok', title: 'Utilisateur supprimé' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  const togglePermission = (id: string) => {
    if (!draft) return
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(id)
        ? draft.permissions.filter((p) => p !== id)
        : [...draft.permissions, id],
    })
  }

  if (loading) return <Loading />

  return (
    <>
      <div className="page-head">
        <span className="muted">{users.length} utilisateur(s)</span>
        <button className="btn btn-primary" onClick={() => setDraft({ ...EMPTY })}>
          <IconPlus size={16} /> Nouvel utilisateur
        </button>
      </div>

      {users.length === 0 ? (
        <EmptyState title="Aucun utilisateur" />
      ) : (
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="row">
              <div className="row-thumb" style={{ display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                {u.username.slice(0, 1).toUpperCase()}
              </div>
              <div className="row-main">
                <div className="row-title flex items-center gap-8">
                  {u.username}
                  <span className={`badge ${u.role === 'admin' ? 'badge-live' : 'badge-info'}`}>{roleLabel(u.role)}</span>
                </div>
                <div className="row-sub">
                  {u.permissions.length} droit(s) · dernière connexion {u.last_login ?? '—'}
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => setDraft({ id: u.id, username: u.username, password: '', role: u.role, permissions: u.permissions })}
                >
                  <IconEdit size={15} />
                </button>
                <button className="btn btn-ghost btn-icon" onClick={() => setToDelete(u)}>
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <Modal
          title={draft.id ? `Éditer : ${draft.username}` : 'Nouvel utilisateur'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDraft(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={save}>
                Enregistrer
              </button>
            </>
          }
        >
          <div className="grid grid-2">
            <div className="field">
              <label>Nom d'utilisateur</label>
              <input className="input" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
            </div>
            <div className="field">
              <label>{draft.id ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'}</label>
              <input
                className="input"
                type="password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                placeholder={draft.id ? 'Laisser vide pour conserver' : '8 caractères minimum'}
              />
            </div>
          </div>

          <div className="field">
            <label>Rôle</label>
            <select className="select" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              {(catalog?.roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="hint">{catalog?.roles?.find((r) => r.id === draft.role)?.description}</span>
          </div>

          <div className="field">
            <label>Droits supplémentaires</label>
            <div className="perm-grid">
              {(catalog?.capabilities ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-8 text-sm">
                  <input type="checkbox" checked={draft.permissions.includes(c.id)} onChange={() => togglePermission(c.id)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer l'utilisateur"
          message={`« ${toDelete.username} » ne pourra plus se connecter.`}
          onConfirm={remove}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}
