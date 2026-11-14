import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Folder, type Media } from '../api'
import {
  ConfirmDialog,
  EmptyState,
  formatBytes,
  formatDuration,
  KindBadge,
  Loading,
  Modal,
  Spinner,
  useToast,
} from '../components/ui'
import { IconFolder, IconImage, IconMedia, IconSearch, IconTrash, IconUpload } from '../components/icons'

type UploadJob = { name: string; progress: number; status: 'pending' | 'done' | 'error'; error?: string }

export default function MediaLibrary() {
  const { push } = useToast()
  const [items, setItems] = useState<Media[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [sort, setSort] = useState<'recent' | 'title' | 'size' | 'duration'>('recent')
  const [folderFilter, setFolderFilter] = useState<number | 0 | ''>('')
  const [drag, setDrag] = useState(false)
  const [uploads, setUploads] = useState<UploadJob[]>([])
  const [preview, setPreview] = useState<Media | null>(null)
  const [toDelete, setToDelete] = useState<Media | null>(null)
  const [renaming, setRenaming] = useState<Media | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [storage, setStorage] = useState<{ media_bytes: number; disk: { free: number; total: number } } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (kind !== 'all') params.set('kind', kind)
    if (folderFilter !== '') params.set('folder_id', String(folderFilter))
    try {
      const [media, fold, store] = await Promise.all([
        api.get<{ items: Media[] }>(`/api/media?${params.toString()}`),
        api.get<{ folders: Folder[] }>('/api/media/folders/list'),
        api.get<typeof storage>('/api/media/storage'),
      ])
      setItems(media.items)
      setFolders(fold.folders)
      setStorage(store)
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
  }, [query, kind, folderFilter, push])

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, query])

  // Sort the loaded items client-side so the sort control reacts instantly
  // without a round-trip (the list is small: a few hundred rows at most).
  const sortedItems = [...items].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title, 'fr')
    if (sort === 'size') return b.size - a.size
    if (sort === 'duration') return b.duration - a.duration
    return b.created_at.localeCompare(a.created_at)
  })

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    const jobs: UploadJob[] = list.map((f) => ({ name: f.name, progress: 0, status: 'pending' }))
    setUploads(jobs)
    const form = new FormData()
    list.forEach((f) => form.append('files', f))
    try {
      await api.upload('/api/media/upload', form)
      setUploads(jobs.map((j) => ({ ...j, progress: 100, status: 'done' })))
      push({ kind: 'ok', title: `${list.length} fichier(s) importé(s)` })
      await load()
      setTimeout(() => setUploads([]), 1500)
    } catch (err: any) {
      setUploads(jobs.map((j) => ({ ...j, status: 'error', error: err?.message })))
      push({ kind: 'err', title: 'Import impossible', message: err?.message })
    }
  }

  const doRename = async () => {
    if (!renaming) return
    try {
      await api.patch(`/api/media/${renaming.id}`, { title: renameValue })
      push({ kind: 'ok', title: 'Média renommé' })
      setRenaming(null)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Renommage impossible', message: err?.message })
    }
  }

  const doDelete = async () => {
    if (!toDelete) return
    try {
      await api.del(`/api/media/${toDelete.id}`)
      push({ kind: 'ok', title: 'Média supprimé' })
      setToDelete(null)
      setPreview(null)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  const createFolder = async () => {
    const name = prompt('Nom du dossier :')
    if (!name?.trim()) return
    try {
      await api.post('/api/media/folders', { name })
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Création impossible', message: err?.message })
    }
  }

  const moveToFolder = async (media: Media, folderId: number | null) => {
    try {
      await api.patch(`/api/media/${media.id}`, { folder_id: folderId ?? 0 })
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Déplacement impossible', message: err?.message })
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="flex gap-8 items-center">
          <div className="tabs">
            {[
              ['all', 'Tous'],
              ['video', 'Vidéos'],
              ['audio', 'Audio'],
              ['image', 'Images'],
            ].map(([v, l]) => (
              <button key={v} className={`tab ${kind === v ? 'active' : ''}`} onClick={() => setKind(v)}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-3)' }}>
              <IconSearch size={16} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 36, width: 260 }}
              placeholder="Rechercher un média…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} title="Trier">
            <option value="recent">Plus récents</option>
            <option value="title">Nom (A→Z)</option>
            <option value="size">Taille (décroissante)</option>
            <option value="duration">Durée (décroissante)</option>
          </select>
        </div>
        <div className="flex gap-8">
          <button className="btn" onClick={createFolder}>
            <IconFolder size={16} /> Dossier
          </button>
          <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
            <IconUpload size={16} /> Importer
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="video/*,audio/*,image/*"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
        </div>
      </div>

      {storage && (
        <div className="flex gap-16 mb-16 text-sm muted-2">
          <span>Médiathèque : {formatBytes(storage.media_bytes)}</span>
          <span>·</span>
          <span>
            Espace disque libre : {formatBytes(storage.disk.free)} / {formatBytes(storage.disk.total)}
          </span>
          <span>·</span>
          <span>{items.length} élément(s)</span>
        </div>
      )}

      {folders.length > 0 && (
        <div className="flex gap-8 mb-16" style={{ flexWrap: 'wrap' }}>
          <button
            className={`badge ${folderFilter === '' ? 'badge-warn' : ''}`}
            onClick={() => setFolderFilter('')}
            style={{ cursor: 'pointer' }}
          >
            Tous les dossiers
          </button>
          <button
            className={`badge ${folderFilter === 0 ? 'badge-warn' : ''}`}
            onClick={() => setFolderFilter(0)}
            style={{ cursor: 'pointer' }}
          >
            Sans dossier
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              className={`badge ${folderFilter === f.id ? 'badge-warn' : ''}`}
              onClick={() => setFolderFilter(f.id)}
              style={{ cursor: 'pointer' }}
            >
              <IconFolder size={12} /> {f.name} ({f.count})
            </button>
          ))}
        </div>
      )}

      <div
        className={`dropzone mb-16 ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (e.dataTransfer.files) void uploadFiles(e.dataTransfer.files)
        }}
        onClick={() => fileInput.current?.click()}
      >
        <IconUpload size={30} />
        <div className="mt-8" style={{ fontWeight: 600, color: 'var(--text-1)' }}>
          Glissez vos fichiers ici
        </div>
        <div className="text-sm">Vidéos, audio et images · import multiple pris en charge</div>
      </div>

      {uploads.length > 0 && (
        <div className="card mb-16">
          {uploads.map((u, i) => (
            <div key={i} className="flex items-center gap-12" style={{ padding: '5px 0' }}>
              {u.status === 'pending' ? (
                <Spinner />
              ) : u.status === 'done' ? (
                <span style={{ color: 'var(--green)' }}>✓</span>
              ) : (
                <span style={{ color: 'var(--red)' }}>✕</span>
              )}
              <span className="truncate grow">{u.name}</span>
              <span className="text-sm muted-2">{u.status === 'error' ? u.error : u.status === 'done' ? 'Terminé' : 'Envoi…'}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon={<IconMedia size={40} />} title="Aucun média" hint="Importez vos premiers fichiers." />
      ) : (
        <div className="media-grid">
          {sortedItems.map((m) => (
            <div key={m.id} className="media-card" onClick={() => setPreview(m)}>
              <div className="media-thumb">
                {m.thumbnail_url ? (
                  <img src={m.thumbnail_url} alt={m.title} loading="lazy" />
                ) : (
                  <span style={{ color: 'var(--text-3)' }}>
                    {m.kind === 'audio' ? <IconImage size={30} /> : <IconMedia size={30} />}
                  </span>
                )}
                <span className="kind-badge">
                  <KindBadge kind={m.kind} />
                </span>
                {m.kind !== 'image' && <span className="dur-badge">{formatDuration(m.duration)}</span>}
              </div>
              <div className="media-body">
                <div className="media-title">{m.title}</div>
                <div className="media-meta">
                  {formatBytes(m.size)}
                  {m.width ? ` · ${m.width}×${m.height}` : ''}
                  {m.fps ? ` · ${m.fps} i/s` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)} wide>
          <div className="stage mb-16">
            {preview.kind === 'image' ? (
              <img src={preview.stream_url} alt={preview.title} />
            ) : preview.kind === 'audio' ? (
              <audio src={preview.stream_url} controls style={{ width: '90%' }} />
            ) : (
              <video src={preview.stream_url} controls />
            )}
          </div>
          <div className="grid grid-2">
            <Meta label="Type" value={preview.kind} />
            <Meta label="Taille" value={formatBytes(preview.size)} />
            <Meta label="Durée" value={formatDuration(preview.duration)} />
            <Meta label="Résolution" value={preview.width ? `${preview.width}×${preview.height}` : '—'} />
            <Meta label="Codec vidéo" value={preview.video_codec ?? '—'} />
            <Meta label="Codec audio" value={preview.audio_codec ?? '—'} />
            <Meta label="Images/s" value={preview.fps ? String(preview.fps) : '—'} />
            <Meta label="Importé le" value={new Date(preview.created_at + 'Z').toLocaleString('fr-FR')} />
          </div>
          {preview.used_in && preview.used_in.length > 0 && (
            <div className="mt-16">
              <div className="text-sm muted-2 mb-8">Utilisé dans</div>
              <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                {preview.used_in.map((p) => (
                  <span key={p.id} className="badge">
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-16">
            <label className="text-sm muted-2">Dossier</label>
            <select
              className="select mt-8"
              value={preview.folder_id ?? 0}
              onChange={(e) => moveToFolder(preview, Number(e.target.value) || null)}
            >
              <option value={0}>Sans dossier</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-8 mt-16">
            <button
              className="btn"
              onClick={() => {
                setRenaming(preview)
                setRenameValue(preview.title)
              }}
            >
              Renommer
            </button>
            <button className="btn btn-danger" onClick={() => setToDelete(preview)}>
              <IconTrash size={16} /> Supprimer
            </button>
          </div>
        </Modal>
      )}

      {renaming && (
        <Modal
          title="Renommer le média"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRenaming(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={doRename}>
                Enregistrer
              </button>
            </>
          }
        >
          <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer le média"
          message={`« ${toDelete.title} » sera définitivement supprimé du disque et des playlists.`}
          onConfirm={doDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '5px 0' }}>
      <div className="text-sm muted-2">{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </div>
  )
}
