import React from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { artistsApi } from '../../api/endpoints/artists'
import { uploadsApi } from '../../api/endpoints/uploads'
import { useAuthStore } from '../../store/authStore'
import Spinner from '../../components/ui/Spinner'

const ArtistSettings: React.FC = () => {
  const user = useAuthStore((s) => s.user)

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ['artist-self', user?.id],
    queryFn: () => artistsApi.getArtistProfile(user!.id as string),
    enabled: Boolean(user?.id),
  })

  const [name, setName] = React.useState('')
  const [bio, setBio] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [avatarUrl, setAvatarUrl] = React.useState<string | undefined>()
  const [bannerUrl, setBannerUrl] = React.useState<string | undefined>()
  const [avatarKey, setAvatarKey] = React.useState<string | undefined>()
  const [bannerKey, setBannerKey] = React.useState<string | undefined>()
  const [saving, setSaving] = React.useState(false)
  const [uploading, setUploading] = React.useState<'avatar' | 'banner' | null>(null)

  React.useEffect(() => {
    if (profile) {
      setName(profile.name ?? '')
      setBio(profile.bio ?? '')
      setUrl((profile as any).artistUrl ?? (profile as any).artist_url ?? '')
      setAvatarUrl(profile.profileImageUrl)
      setBannerUrl(profile.bannerImageUrl)
    }
  }, [profile])

  const upload = async (file: File, which: 'avatar' | 'banner') => {
    if (!/^image\//.test(file.type)) {
      toast.error('Choose an image file')
      return
    }
    setUploading(which)
    try {
      const { key, publicUrl } = await uploadsApi.uploadDirect(file, 'images')
      if (which === 'avatar') {
        setAvatarKey(key)
        setAvatarUrl(publicUrl)
      } else {
        setBannerKey(key)
        setBannerUrl(publicUrl)
      }
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await artistsApi.updateProfile({
        name: name.trim(),
        bio: bio.trim(),
        url: url.trim(),
        avatar: avatarKey,
        banner: bannerKey,
      })
      toast.success('Profile saved')
      await refetch()
    } catch {
      toast.error('Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  }

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900">Artist Settings</h1>
      <p className="text-gray-600">Your public brand page — banner, avatar, and bio.</p>

      <form className="mt-6 space-y-5" onSubmit={save}>
        {/* Banner */}
        <div>
          <label className="block text-sm font-medium mb-1">Banner</label>
          <div className="relative h-32 w-full overflow-hidden rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500">
            {bannerUrl && <img src={bannerUrl} alt="banner" className="h-full w-full object-cover" />}
          </div>
          <input type="file" accept="image/*" className="mt-2 text-sm" disabled={uploading !== null}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'banner')} />
          {uploading === 'banner' && <span className="ml-2 text-xs text-gray-500">Uploading…</span>}
        </div>

        {/* Avatar */}
        <div>
          <label className="block text-sm font-medium mb-1">Avatar</label>
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-gray-100">
              {avatarUrl && <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />}
            </div>
            <input type="file" accept="image/*" className="text-sm" disabled={uploading !== null}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'avatar')} />
            {uploading === 'avatar' && <span className="text-xs text-gray-500">Uploading…</span>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Studio / artist name</label>
          <input className="w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Bio</label>
          <textarea className="w-full border rounded px-3 py-2" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Link (Patreon, Instagram, website…)</label>
          <input className="w-full border rounded px-3 py-2" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>

        <button type="submit" disabled={saving || uploading !== null} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </div>
  )
}

export default ArtistSettings
