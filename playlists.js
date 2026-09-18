class PlaylistManager {
    constructor() { this.playlists = []; this.loadPlaylists(); }
    loadPlaylists() { const saved = localStorage.getItem('playlists'); if (saved) try { this.playlists = JSON.parse(saved); } catch(e) { this.playlists = []; } }
    savePlaylists() { localStorage.setItem('playlists', JSON.stringify(this.playlists)); }
    createPlaylist(name) {
        const playlist = { id: Date.now(), name: name, tracks: [], createdAt: new Date().toISOString() };
        this.playlists.push(playlist); this.savePlaylists(); return playlist;
    }
    deletePlaylist(id) { this.playlists = this.playlists.filter(p => p.id !== id); this.savePlaylists(); }
    addTrackToPlaylist(playlistId, track) {
        const playlist = this.playlists.find(p => p.id === playlistId);
        if (playlist && !playlist.tracks.find(t => t.id === track.id)) {
            playlist.tracks.push({ id: track.id, title: track.title, artist: track.artist, duration: track.duration, region: track.region ?? -1 });
            this.savePlaylists(); return true;
        }
        return false;
    }
    getPlaylist(id) { return this.playlists.find(p => p.id === id); }
    getAllPlaylists() { return this.playlists; }
    getPlaylistCount() { return this.playlists.length; }
}