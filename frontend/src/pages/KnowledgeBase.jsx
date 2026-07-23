import { showConfirm } from '../utils/confirm'
import React, { useEffect, useState } from 'react'
import {
  getKBCategories, getKBArticles, getKBArticle,
  createKBArticle, updateKBArticle, deleteKBArticle,
  createKBCategory
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import { Lock, Users, Globe } from 'lucide-react'
import { useFormGuard } from '../context/UnsavedChangesContext'
import { Search, Plus, BookOpen, ChevronRight, ArrowLeft, Edit, Trash2, Eye, Save, Code } from 'lucide-react'
import { fmtD } from '../utils/fmt'
import toast from 'react-hot-toast'

const EMPTY_ARTICLE = { title: '', content: '', category_id: '', tags: '', audience: 'all', is_published: true }

const AUDIENCE_OPTIONS = [
  { value: 'all',    label: 'Todos',              icon: Globe,  color: 'text-green-600',  bg: 'bg-green-100' },
  { value: 'agents', label: 'Agentes y admins',   icon: Users,  color: 'text-blue-600',   bg: 'bg-blue-100' },
  { value: 'admin',  label: 'Solo administradores', icon: Lock, color: 'text-purple-600', bg: 'bg-purple-100' },
]

function AudienceBadge({ audience }) {
  const opt = AUDIENCE_OPTIONS.find(o => o.value === (audience || 'all')) || AUDIENCE_OPTIONS[0]
  const Icon = opt.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${opt.bg} ${opt.color}`}>
      <Icon size={10} />
      {opt.label}
    </span>
  )
}

function renderMarkdown(text) {
  if (!text) return ''
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) => s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;color:#db2777;padding:1px 5px;border-radius:4px;font-size:12px;font-family:monospace">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safeUrl = /^(https?:\/\/|\/|#)/.test(url) ? url : '#'
      return `<a href="${safeUrl}" style="color:#2563eb;text-decoration:underline" target="_blank" rel="noopener noreferrer">${label}</a>`
    })
  const blocks = esc(text).split(/\n\n+/)
  return blocks.map((block) => {
    const lines = block.split('\n')
    const first = lines[0]
    if (/^### /.test(first)) return `<h3 style="font-size:15px;font-weight:700;color:#111827;margin:16px 0 6px">${inline(first.slice(4))}</h3>`
    if (/^## /.test(first))  return `<h2 style="font-size:17px;font-weight:700;color:#111827;margin:20px 0 8px">${inline(first.slice(3))}</h2>`
    if (/^# /.test(first))   return `<h1 style="font-size:20px;font-weight:800;color:#111827;margin:24px 0 10px">${inline(first.slice(2))}</h1>`
    if (/^---+$/.test(first.trim())) return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">'
    if (/^> /.test(first)) {
      const content = lines.map((l) => inline(l.replace(/^> ?/, ''))).join('<br>')
      return `<blockquote style="border-left:3px solid #d1d5db;padding:6px 12px;color:#6b7280;font-style:italic;margin:8px 0">${content}</blockquote>`
    }
    if (/^[-*] /.test(first)) {
      const items = lines.filter((l) => /^[-*] /.test(l)).map((l) => `<li>${inline(l.slice(2))}</li>`).join('')
      return `<ul style="list-style:disc;padding-left:20px;margin:6px 0;line-height:1.7">${items}</ul>`
    }
    if (/^\d+\. /.test(first)) {
      const items = lines.filter((l) => /^\d+\. /.test(l)).map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')
      return `<ol style="list-style:decimal;padding-left:20px;margin:6px 0;line-height:1.7">${items}</ol>`
    }
    return `<p style="margin:0 0 8px;line-height:1.7">${lines.map(inline).join('<br>')}</p>`
  }).join('')
}

export default function KnowledgeBase() {
  const { isAgentOrAdmin, isAdmin } = useAuth()
  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState([])
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editArticle, setEditArticle] = useState(null)
  const [form, setForm] = useState(EMPTY_ARTICLE)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [editorTab, setEditorTab] = useState('edit')
  useFormGuard(isDirty && showForm)

  const fetchData = () => {
    Promise.all([getKBCategories(), getKBArticles({ published_only: !isAgentOrAdmin })])
      .then(([catRes, artRes]) => {
        setCategories(catRes.data)
        setArticles(artRes.data)
      })
      .catch(() => toast.error('Error cargando base de conocimientos'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      const params = {}
      if (selectedCategory) params.category_id = selectedCategory.id
      if (search) params.search = search
      params.published_only = !isAgentOrAdmin
      getKBArticles(params)
        .then((res) => setArticles(res.data))
        .catch(() => {})
    }, search ? 320 : 0)
    return () => clearTimeout(t)
  }, [selectedCategory, search])

  const handleViewArticle = async (id) => {
    try {
      const res = await getKBArticle(id)
      setSelectedArticle(res.data)
    } catch {
      toast.error('Error cargando artículo')
    }
  }

  const openCreate = () => {
    setEditArticle(null)
    setForm(EMPTY_ARTICLE)
    setIsDirty(false)
    setShowForm(true)
  }

  const openEdit = (article) => {
    setEditArticle(article)
    setForm({
      title: article.title,
      content: article.content,
      category_id: article.category?.id || '',
      tags: article.tags || '',
      audience: article.audience || 'all',
      is_published: article.is_published,
    })
    setIsDirty(false)
    setShowForm(true)
    setSelectedArticle(null)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        category_id: form.category_id ? parseInt(form.category_id) : null,
      }
      if (editArticle) {
        await updateKBArticle(editArticle.id, payload)
        toast.success('Artículo actualizado')
      } else {
        await createKBArticle(payload)
        toast.success('Artículo creado')
      }
      setIsDirty(false)
      setShowForm(false)
      fetchData()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando artículo')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!await showConfirm('¿Eliminar este artículo?')) return
    try {
      await deleteKBArticle(id)
      toast.success('Artículo eliminado')
      setSelectedArticle(null)
      fetchData()
    } catch {
      toast.error('Error eliminando')
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando...</div>

  if (showForm) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <button onClick={() => { setIsDirty(false); setShowForm(false) }} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6">
          <ArrowLeft size={16} /> Volver
        </button>
        <div className="card">
          <h2 className="text-xl font-bold text-gray-900 mb-6">
            {editArticle ? 'Editar Artículo' : 'Nuevo Artículo'}
          </h2>
          <form id="kb-article-form" onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="label">Título *</label>
              <input className="input" style={{fontSize:'16px'}} value={form.title} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, title: e.target.value })) }} required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Categoría</label>
                <select className="input" style={{fontSize:'16px'}} value={form.category_id} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, category_id: e.target.value })) }}>
                  <option value="">Sin categoría</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Tags (separados por coma)</label>
                <input className="input" style={{fontSize:'16px'}} value={form.tags} onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, tags: e.target.value })) }} placeholder="guía, configuración..." />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">Contenido * (soporta Markdown)</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  <button type="button" onClick={() => setEditorTab('edit')}
                    className={`flex items-center gap-1 px-3 py-1 text-xs font-medium transition-colors ${editorTab === 'edit' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    <Code size={12} /> Editar
                  </button>
                  <button type="button" onClick={() => setEditorTab('preview')}
                    className={`flex items-center gap-1 px-3 py-1 text-xs font-medium border-l border-gray-200 transition-colors ${editorTab === 'preview' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    <Eye size={12} /> Vista previa
                  </button>
                </div>
              </div>
              {editorTab === 'edit' ? (
                <textarea
                  className="input font-mono text-sm h-64 resize-y"
                  style={{fontSize:'16px'}}
                  value={form.content}
                  onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, content: e.target.value })) }}
                  required
                  placeholder="## Título&#10;&#10;Contenido del artículo..."
                />
              ) : (
                <div
                  className="input h-64 overflow-y-auto text-sm text-gray-700 bg-white"
                  dangerouslySetInnerHTML={{ __html: form.content ? renderMarkdown(form.content) : '<p class="text-gray-400 italic">Sin contenido aún...</p>' }}
                />
              )}
            </div>
            <div>
              <label className="label">Visibilidad</label>
              <div className="flex gap-2 flex-wrap">
                {AUDIENCE_OPTIONS.filter(o => o.value !== 'admin' || isAdmin).map(o => {
                  const Icon = o.icon
                  const active = form.audience === o.value
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { setIsDirty(true); setForm(f => ({ ...f, audience: o.value })) }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                        active ? `${o.bg} ${o.color} border-current` : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <Icon size={13} />
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="published"
                checked={form.is_published}
                onChange={(e) => { setIsDirty(true); setForm((f) => ({ ...f, is_published: e.target.checked })) }}
                className="rounded"
              />
              <label htmlFor="published" className="text-sm text-gray-700">Publicado</label>
            </div>
          </form>
        </div>

      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] z-10 -mx-4 sm:-mx-6">
        <span className={`text-xs flex items-center gap-1.5 ${isDirty ? 'text-amber-600' : 'text-gray-300'}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isDirty ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'}`} />
          {isDirty ? 'Sin guardar' : 'Sin cambios'}
        </span>
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={() => { setIsDirty(false); setShowForm(false) }} className="btn-secondary text-sm py-1.5 px-3">Cancelar</button>
          <button type="submit" form="kb-article-form" disabled={saving} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
            <Save size={13} />
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
    )
  }

  if (selectedArticle) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <button onClick={() => setSelectedArticle(null)} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6">
          <ArrowLeft size={16} /> Volver a la lista
        </button>
        <div className="card">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {selectedArticle.category && (
                  <span className="badge bg-blue-100 text-blue-700">{selectedArticle.category.name}</span>
                )}
                {!selectedArticle.is_published && (
                  <span className="badge bg-yellow-100 text-yellow-700">Borrador</span>
                )}
                {isAgentOrAdmin && selectedArticle.audience && selectedArticle.audience !== 'all' && (
                  <AudienceBadge audience={selectedArticle.audience} />
                )}
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{selectedArticle.title}</h1>
              <p className="text-sm text-gray-400 mt-1">
                Por {selectedArticle.created_by?.name} ·{' '}
                {fmtD(selectedArticle.created_at)} ·{' '}
                <Eye size={12} className="inline" /> {selectedArticle.views} vistas
              </p>
            </div>
            {isAgentOrAdmin && (
              <div className="flex gap-2">
                <button onClick={() => openEdit(selectedArticle)} className="btn-secondary">
                  <Edit size={14} />
                </button>
                <button onClick={() => handleDelete(selectedArticle.id)} className="p-2 hover:bg-red-100 rounded-lg text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
          {selectedArticle.tags && (
            <div className="flex gap-2 mb-4 flex-wrap">
              {selectedArticle.tags.split(',').map((tag) => (
                <span key={tag} className="badge bg-gray-100 text-gray-600">{tag.trim()}</span>
              ))}
            </div>
          )}
          <div
            className="prose max-w-none text-gray-700 text-sm border-t pt-4"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedArticle.content) }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Base de Conocimientos</h1>
          <p className="text-sm text-gray-500 mt-1">{articles.length} artículo(s)</p>
        </div>
        {isAgentOrAdmin && (
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Nuevo Artículo
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Categorías */}
        <div>
          <div className="card p-4">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Categorías</h3>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  !selectedCategory ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Todos los artículos
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${
                    selectedCategory?.id === cat.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>{cat.name}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Artículos */}
        <div className="lg:col-span-3">
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              style={{fontSize:'16px'}}
              placeholder="Buscar artículos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {articles.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay artículos disponibles</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {articles.map((article) => (
                <div
                  key={article.id}
                  className="card cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handleViewArticle(article.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {article.category && (
                        <span className="badge bg-blue-100 text-blue-600 text-xs">{article.category.name}</span>
                      )}
                      {!article.is_published && (
                        <span className="badge bg-yellow-100 text-yellow-600 text-xs">Borrador</span>
                      )}
                      {isAgentOrAdmin && article.audience && article.audience !== 'all' && (
                        <AudienceBadge audience={article.audience} />
                      )}
                    </div>
                    <Eye size={13} className="text-gray-300 flex-shrink-0" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1 text-sm line-clamp-2">{article.title}</h3>
                  <p className="text-xs text-gray-400">
                    {fmtD(article.created_at)} · {article.views} vistas
                  </p>
                  {article.tags && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {article.tags.split(',').slice(0, 3).map((t) => (
                        <span key={t} className="badge bg-gray-100 text-gray-500 text-xs">{t.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
