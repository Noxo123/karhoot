export const API = {
  token: localStorage.getItem('karhoot_token'),
  async request(path, options={}) {
    const headers = {'Content-Type':'application/json', ...(options.headers||{})};
    if (this.token) headers.Authorization=`Bearer ${this.token}`;
    const res = await fetch(`/api${path}`, {...options, headers});
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  },
  setSession(data){ this.token=data.token; localStorage.setItem('karhoot_token',data.token); localStorage.setItem('karhoot_user',JSON.stringify(data.user)); },
  logout(){ this.token=null; localStorage.removeItem('karhoot_token'); localStorage.removeItem('karhoot_user'); location.href='/'; },
  user(){ try{return JSON.parse(localStorage.getItem('karhoot_user')||'null')}catch{return null} }
};
export function escapeHTML(value){ const d=document.createElement('div'); d.textContent=String(value ?? ''); return d.innerHTML; }
