import { useCallback, useEffect, useState } from 'react'
import { api, type Stream } from '../api'
import { ConfirmDialog, EmptyState, Loading, Modal, useToast } from '../components/ui'
import { IconEdit, IconPlus, IconStreams, IconTrash, IconZap } from '../components/icons'

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium']
const PRIVACY = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Non répertorié' },
  { value: 'private', label: 'Privé' },
]

type Draft = Omit<Stream, 'id' | 'has_stream_key' | 'stream_key_masked' | 'tags'> & {
  id?: number
  tags: string
  stream_key?: string
}

const EMPTY: Draft = {
  name: '',
  description: '',
  tags: '',
  privacy: 'public',
  category: '',
  encoding: 'veryfast',
  kind: 'rtmp',
  rtmp_url: 'rtmp://a.rtmp.youtube.com/live2',
  output_file: '',
  width: 1280,
  height: 720,
  fps: 25,
  bitrate: 2500,
  audio_bitrate: 128,
  enabled: true,
}

export default function Streams() {
  const { push } = useToast()
  const [streams, setStreams] = useState<Stream[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [toDelete, setToDelete] = useState<Stream | null>(null)
  const [testing, setTesting] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ items: Stream[] }>('/api/streams')
      setStreams(data.items)
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = () => setDraft({ ...EMPTY })
  const openEdit = (s: Stream) =>
    setDraft({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      tags: s.tags.join(', '),
      privacy: s.privacy,
      category: s.category ?? '',
      encoding: s.encoding,
      kind: s.kind,
      rtmp_url: s.rtmp_url ?? '',
      output_file: s.output_file ?? '',
      width: s.width,
      height: s.height,
      fps: s.fps,
      bitrate: s.bitrate,
      audio_bitrate: s.audio_bitrate,
      enabled: s.enabled,
      stream_key: '',
    })

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      push({ kind: 'err', title: 'Le nom est requis' })
      return
    }
    const payload: Record<string, unknown> = {
      name: draft.name,
      description: draft.description || null,
      tags: draft.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      privacy: draft.privacy,
      category: draft.category || null,
      encoding: draft.encoding,
      kind: draft.kind,
      rtmp_url: draft.kind === 'rtmp' ? draft.rtmp_url || null : null,
      output_file: draft.kind === 'file' ? draft.output_file || null : null,
      width: draft.width,
      height: draft.height,
      fps: draft.fps,
      bitrate: draft.bitrate,
      audio_bitrate: draft.audio_bitrate,
      enabled: draft.enabled,
    }
    if (draft.stream_key) payload.stream_key = draft.stream_key
    try {
      if (draft.id) await api.put(`/api/streams/${draft.id}`, payload)
      else await api.post('/api/streams', payload)
      push({ kind: 'ok', title: 'Flux enregistré' })
      setDraft(null)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Enregistrement impossible', message: err?.message })
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await api.del(`/api/streams/${toDelete.id}`)
      setToDelete(null)
      await load()
      push({ kind: 'ok', title: 'Flux supprimé' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  const test = async (id: number) => {
    setTesting(id)
    try {
      const res = await api.post<{ ok: boolean; message?: string; error?: string }>(`/api/streams/${id}/test`, {})
      push(res.ok ? { kind: 'ok', title: res.message ?? 'Connexion réussie' } : { kind: 'err', title: 'Échec du test', message: res.error })
    } catch (err: any) {
      push({ kind: 'err', title: 'Test impossible', message: err?.message })
    } finally {
      setTesting(null)
    }
  }

  if (loading) return <Loading />

  return (
    <>
      <div className="page-head">
        <span className="muted">{streams.length} flux de sortie</span>
        <button className="btn btn-primary" onClick={openNew}>
          <IconPlus size={16} /> Nouveau flux
        </button>
      </div>

      {streams.length === 0 ? (
        <EmptyState
          icon={<IconStreams size={40} />}
          title="Aucun flux de sortie"
          hint="Ajoutez des destinations RTMP (YouTube, Twitch…) pour diffuser simultanément sur plusieurs plateformes."
        />
      ) : (
        <div className="list">
          {streams.map((s) => (
            <div key={s.id} className="row">
              <div className="row-thumb" style={{ display: 'grid', placeItems: 'center' }}>
                <IconStreams size={18} />
              </div>
              <div className="row-main">
                <div className="row-title flex items-center gap-8">
                  {s.name}
                  {!s.enabled && <span className="badge">Désactivé</span>}
                  <span className="badge badge-info">{s.kind === 'rtmp' ? 'RTMP' : 'Fichier'}</span>
                </div>
                <div className="row-sub">
                  {s.width}×{s.height} · {s.fps} i/s · {s.bitrate} kbps · {s.encoding}
                  {s.category ? ` · ${s.category}` : ''}
                  {s.tags.length ? ` · ${s.tags.join(', ')}` : ''}
                </div>
                <div className="row-sub mono truncate">
                  {s.kind === 'rtmp' ? s.rtmp_url : s.output_file}
                  {s.has_stream_key ? ` · clé ${s.stream_key_masked}` : ''}
                </div>
              </div>
              <div className="row-actions">
                <span className="badge">{PRIVACY.find((p) => p.value === s.privacy)?.label ?? s.privacy}</span>
                {s.kind === 'rtmp' && (
                  <button className="btn btn-sm" disabled={testing === s.id} onClick={() => test(s.id)}>
                    <IconZap size={14} /> Tester
                  </button>
                )}
                <button className="btn btn-ghost btn-icon" onClick={() => openEdit(s)}>
                  <IconEdit size={15} />
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
          title={draft.id ? `Éditer : ${draft.name}` : 'Nouveau flux de sortie'}
          onClose={() => setDraft(null)}
          wide
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
              <label>Nom</label>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Catégorie</label>
              <input className="input" value={draft.category ?? ''} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="News, Musique…" />
            </div>
          </div>

          <div className="field">
            <label>Description</label>
            <textarea className="input" rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label>Étiquettes (séparées par des virgules)</label>
              <input className="input" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="live, info" />
            </div>
            <div className="field">
              <label>Confidentialité</label>
              <select className="select" value={draft.privacy} onChange={(e) => setDraft({ ...draft, privacy: e.target.value as Draft['privacy'] })}>
                {PRIVACY.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label>Type de sortie</label>
              <select className="select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}>
                <option value="rtmp">RTMP</option>
                <option value="file">Fichier local</option>
              </select>
            </div>
            <div className="field">
              <label>Encodage (préréglage)</label>
              <select className="select" value={draft.encoding} onChange={(e) => setDraft({ ...draft, encoding: e.target.value })}>
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {draft.kind === 'rtmp' ? (
            <>
              <div className="field">
                <label>URL du serveur RTMP</label>
                <input className="input mono" value={draft.rtmp_url ?? ''} onChange={(e) => setDraft({ ...draft, rtmp_url: e.target.value })} />
              </div>
              <div className="field">
                <label>Clé de flux</label>
                <input
                  className="input mono"
                  type="password"
                  value={draft.stream_key ?? ''}
                  onChange={(e) => setDraft({ ...draft, stream_key: e.target.value })}
                  placeholder={draft.id ? 'Laisser vide pour conserver' : 'Clé de diffusion'}
                />
                <span className="hint">Jamais affichée en clair.</span>
              </div>
            </>
          ) : (
            <div className="field">
              <label>Chemin du fichier</label>
              <input className="input mono" value={draft.output_file ?? ''} onChange={(e) => setDraft({ ...draft, output_file: e.target.value })} />
            </div>
          )}

          <div className="grid grid-4">
            <div className="field">
              <label>Largeur</label>
              <input className="input" type="number" value={draft.width} onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Hauteur</label>
              <input className="input" type="number" value={draft.height} onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Images/s</label>
              <input className="input" type="number" value={draft.fps} onChange={(e) => setDraft({ ...draft, fps: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Débit (kbps)</label>
              <input className="input" type="number" value={draft.bitrate} onChange={(e) => setDraft({ ...draft, bitrate: Number(e.target.value) })} />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label>Débit audio (kbps)</label>
              <input className="input" type="number" value={draft.audio_bitrate} onChange={(e) => setDraft({ ...draft, audio_bitrate: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Activation</label>
              <label className="flex items-center gap-8">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                <span className="text-sm muted">Flux actif (diffusé par le moteur)</span>
              </label>
            </div>
          </div>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer le flux"
          message={`« ${toDelete.name} » ne recevra plus la diffusion.`}
          onConfirm={remove}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}
