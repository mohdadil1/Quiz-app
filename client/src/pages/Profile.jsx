import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';
import PasswordInput from '../components/PasswordInput';
import Avatar from '../components/Avatar';
import { useAuth } from '../context/AuthContext';

const GENDER_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' }
];

const AVATAR_SIZE = 256;

// Centre-crop an image file to a square and shrink it, so the stored picture stays small
function resizeToAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      canvas.getContext('2d').drawImage(
        img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, AVATAR_SIZE, AVATAR_SIZE
      );
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState({ name: user?.name || '', gender: user?.gender || '', avatar: user?.avatar || '' });
  const [profileMsg, setProfileMsg] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef(null);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  // Load the latest profile from the server (the saved login copy may be stale)
  useEffect(() => {
    api.get('/teachers/me').then(({ data }) => {
      setProfile({ name: data.name || '', gender: data.gender || '', avatar: data.avatar || '' });
      updateUser({ name: data.name, gender: data.gender, avatar: data.avatar });
    }).catch(() => {});
  }, [updateUser]);

  const saveProfile = async (changes, successText) => {
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const { data } = await api.put('/teachers/me', changes);
      setProfile({ name: data.name || '', gender: data.gender || '', avatar: data.avatar || '' });
      updateUser({ name: data.name, gender: data.gender, avatar: data.avatar });
      setProfileMsg({ type: 'success', text: successText });
    } catch (e) {
      setProfileMsg({ type: 'error', text: e?.response?.data?.message || 'Could not save profile' });
    } finally {
      setSavingProfile(false);
    }
  };

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      return setProfileMsg({ type: 'error', text: 'Choose an image file (JPG, PNG or WebP)' });
    }
    try {
      const avatar = await resizeToAvatar(file);
      await saveProfile({ avatar }, 'Profile picture updated');
    } catch {
      setProfileMsg({ type: 'error', text: 'Could not read that image. Try a different file.' });
    }
  };

  const submitDetails = (e) => {
    e.preventDefault();
    saveProfile({ name: profile.name, gender: profile.gender }, 'Profile saved');
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 6) return setPwMsg({ type: 'error', text: 'New password must be at least 6 characters' });
    if (pw.next !== pw.confirm) return setPwMsg({ type: 'error', text: 'New passwords do not match' });
    setSavingPw(true);
    try {
      await api.post('/teachers/me/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ type: 'success', text: 'Password changed. Other devices have been signed out.' });
    } catch (e) {
      setPwMsg({ type: 'error', text: e?.response?.data?.message || 'Could not change password' });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <TeacherLayout title="Profile" showBack>
      <div className="row row-2">
        <div className="card">
          <div className="card-header"><h3>Profile</h3></div>
          <div className="card-body">
            {profileMsg && <div className={`alert alert-${profileMsg.type}`}>{profileMsg.text}</div>}

            <div className="profile-photo">
              <Avatar src={profile.avatar} name={profile.name} email={user?.email} size={96} />
              <div className="flex flex-gap">
                <button type="button" className="btn btn-secondary btn-sm" disabled={savingProfile}
                  onClick={() => fileRef.current?.click()}>
                  {profile.avatar ? 'Change photo' : 'Upload photo'}
                </button>
                {profile.avatar && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={savingProfile}
                    onClick={() => saveProfile({ avatar: '' }, 'Profile picture removed')}>
                    Remove
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPickPhoto} />
            </div>

            <form onSubmit={submitDetails}>
              <div className="form-group">
                <label>Email</label>
                <input className="form-control" value={user?.email || ''} disabled readOnly />
              </div>
              <div className="form-group">
                <label>Name</label>
                <input className="form-control" value={profile.name} maxLength={80}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Your name" />
              </div>
              <div className="form-group">
                <label>Gender</label>
                <select className="form-control" value={profile.gender}
                  onChange={(e) => setProfile({ ...profile, gender: e.target.value })}>
                  {GENDER_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={savingProfile}>
                {savingProfile ? 'SAVING…' : 'SAVE PROFILE'}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Change Password</h3></div>
          <div className="card-body">
            {pwMsg && <div className={`alert alert-${pwMsg.type}`}>{pwMsg.text}</div>}
            <form onSubmit={submitPassword}>
              <div className="form-group">
                <label>Current password</label>
                <PasswordInput value={pw.current} autoComplete="current-password" required
                  onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </div>
              <div className="form-group">
                <label>New password</label>
                <PasswordInput value={pw.next} autoComplete="new-password" placeholder="At least 6 characters" required
                  onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Confirm new password</label>
                <PasswordInput value={pw.confirm} autoComplete="new-password" required
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={savingPw}>
                {savingPw ? 'CHANGING…' : 'CHANGE PASSWORD'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </TeacherLayout>
  );
}
