import { useCallback, useEffect, useState } from 'react'
import { api, type Playlist, type Schedule } from '../api'
import { ConfirmDialog, EmptyState, Loading, Modal, useToast } from '../components/ui'
import { IconCalendar, IconPlus, IconTrash } from '../components/icons'

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

const emptyDraft = (): Schedule => ({
  id: 0,
  name: '',
  playlist_id: null,
  days: [0, 1, 2, 3, 4, 5, 6],
  start_time: '08:00',
  end_time: '12:00',
  enabled: true,
})

export default function Scheduling() {
  const { push } = useToast()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Schedule | null>(null)
  const [toDelete, setToDelete] = useState<Schedule | null>(null)
  const [fallback, setFallback] = useState<number | ''>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p, settings] = await Promise.all([
        api.get<{ items: Schedule[] }>('/api/schedules'),
        api.get<{ items: Playlist[] }>('/api/playlists'),
        api.get<{ fallback_playlist_id?: string }>('/api/broadcast/settings'),
      ])
      setSchedules(s.items)
      setPlaylists(p.items)
      setFallback(settings.fallback_playlist_id ? Number(settings.fallback_playlist_id) : '')
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) return push({ kind: 'err', title: 'Le nom est requis' })
    try {
      const payload = {
        name: draft.name,
        playlist_id: draft.playlist_id,
        days: draft.days,
        start_time: draft.start_time,
        end_time: draft.end_time,
        enabled: draft.enabled,
      }
      if (draft.id === 0) await api.post('/api/schedules', payload)
      else await api.put(`/api/schedules/${draft.id}`, payload)
      push({ kind: 'ok', title: 'Programme enregistré' })
      setDraft(null)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Enregistrement impossible', message: err?.message })
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await api.del(`/api/schedules/${toDelete.id}`)
      setToDelete(null)
      await load()
      push({ kind: 'ok', title: 'Programme supprimé' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  const saveFallback = async (value: number | '') => {
    setFallback(value)
    try {
      await api.put('/api/broadcast/settings', {
        fallback_playlist_id: value === '' ? 0 : value,
      })
      push({ kind: 'ok', title: 'Playlist de secours enregistrée' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Enregistrement impossible', message: err?.message })
    }
  }

  if (loading) return <Loading />

  const playlistName = (id: number | null) => playlists.find((p) => p.id === id)?.name ?? '—'

  return (
    <>
      <div className="page-head">
        <span className="muted">{schedules.length} programme(s)</span>
        <button className="btn btn-primary" onClick={() => setDraft(emptyDraft())}>
          <IconPlus size={16} /> Nouveau programme
        </button>
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <span className="card-title">Playlist de secours</span>
        </div>
        <p className="muted text-sm mb-8">
          Diffusée automatiquement lorsqu'aucun programme planifié n'est actif.
        </p>
        <select
          className="select"
          value={fallback}
          onChange={(e) => saveFallback(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Aucune</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {schedules.length === 0 ? (
        <EmptyState
          icon={<IconCalendar size={40} />}
          title="Aucun programme"
          hint="Créez des plages horaires récurrentes pour automatiser la diffusion."
        />
      ) : (
        <div className="list">
          {schedules.map((s) => (
            <div key={s.id} className="row">
              <div className="row-main">
                <div className="row-title flex items-center gap-8">
                  {s.name}
                  {!s.enabled && <span className="badge">Désactivé</span>}
                </div>
                <div className="row-sub flex gap-8 items-center" style={{ flexWrap: 'wrap' }}>
                  <span className="mono">
                    {s.start_time} → {s.end_time}
                  </span>
                  <span>·</span>
                  <span className="flex gap-8" style={{ gap: 4 }}>
                    {DAYS.map((d, i) => (
                      <span
                        key={d}
                        className="badge"
                        style={{
                          padding: '1px 7px',
                          background: s.days.includes(i) ? 'var(--accent-soft)' : 'var(--bg-3)',
                          color: s.days.includes(i) ? 'var(--accent)' : 'var(--text-3)',
                          borderColor: s.days.includes(i) ? 'var(--accent-line)' : 'var(--line-soft)',
                        }}
                      >
                        {d}
                      </span>
                    ))}
                  </span>
                  <span>·</span>
                  <span>{playlistName(s.playlist_id)}</span>
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => api.put(`/api/schedules/${s.id}`, { ...s, enabled: !s.enabled }).then(load)}
                >
                  {s.enabled ? 'Désactiver' : 'Activer'}
                </button>
                <button className="btn btn-sm" onClick={() => setDraft({ ...s })}>
                  Modifier
                </button>
                <button className="btn btn-ghost btn-icon" onClick={() => setToDelete(s)}>
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <Modal
          title={draft.id === 0 ? 'Nouveau programme' : 'Modifier le programme'}
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
          <div className="field">
            <label>Nom du programme</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="field">
            <label>Playlist</label>
            <select
              className="select"
              value={draft.playlist_id ?? ''}
              onChange={(e) => setDraft({ ...draft, playlist_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— Choisir —</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Début</label>
              <input
                className="input"
                type="time"
                value={draft.start_time}
                onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Fin</label>
              <input
                className="input"
                type="time"
                value={draft.end_time}
                onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
              />
              <span className="hint">Une fin avant le début couvre la nuit.</span>
            </div>
          </div>
          <div className="field">
            <label>Jours de diffusion</label>
            <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  className={`badge ${draft.days.includes(i) ? 'badge-warn' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      days: draft.days.includes(i)
                        ? draft.days.filter((x) => x !== i)
                        : [...draft.days, i].sort(),
                    })
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-8">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            <span className="text-sm muted">Programme actif</span>
          </label>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer le programme"
          message={`« ${toDelete.name} » sera supprimé.`}
          onConfirm={remove}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}
