// Searchable "add layer" menu. Lists every layer type with its help text so the
// operator immediately knows what each one does and which API it uses.

import { useMemo, useState } from 'react'
import type { LayerTypeInfo } from '../api'
import { IconPlus, IconSearch } from './icons'

export default function AddLayerMenu({
  types,
  onAdd,
}: {
  types: LayerTypeInfo[]
  onAdd: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return types
    return types.filter(
      (t) => t.label.toLowerCase().includes(q) || t.help.toLowerCase().includes(q),
    )
  }, [types, query])

  return (
    <div className="add-layer">
      <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
        <IconPlus size={14} /> Ajouter un calque
      </button>
      {open && (
        <div className="add-layer-menu" onMouseLeave={() => setOpen(false)}>
          <div className="add-layer-search">
            <IconSearch size={14} />
            <input
              className="input"
              placeholder="Rechercher…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="add-layer-list">
            {filtered.map((t) => (
              <button
                key={t.id}
                className="add-layer-item"
                onClick={() => {
                  onAdd(t.id)
                  setOpen(false)
                  setQuery('')
                }}
              >
                <span className="add-layer-title">{t.label}</span>
                <span className="add-layer-help">{t.help}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="text-sm muted-2 p-8">Aucun résultat</div>}
          </div>
        </div>
      )}
    </div>
  )
}
