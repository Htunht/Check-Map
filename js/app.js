(function () {
  "use strict";

  /**
   * Web app config (Firebase console → Project settings → Your apps).
   * databaseURL: Realtime Database → Data tab (use the exact URL shown there;
   * regional DBs often end in .firebasedatabase.app instead of .firebaseio.com).
   * This file uses the compat CDN; measurementId is unused unless you add Analytics.
   */
  const firebaseConfig = {
    apiKey: "AIzaSyBb1PqDTDDinyVA0_dftw14VSqVqBzTIv4",
    authDomain: "check-map-4ea9f.firebaseapp.com",
    databaseURL:
      "https://check-map-4ea9f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "check-map-4ea9f",
    storageBucket: "check-map-4ea9f.firebasestorage.app",
    messagingSenderId: "1033897630029",
    appId: "1:1033897630029:web:a4a95e0bb2b1f224ca7f04",
    measurementId: "G-3ZLBETPXG1",
  };

  const DEFAULT = { lat: 16.8661, lng: 96.1951, z: 12 };
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  /** Everyone joins this room; URL is normalized to include ?room=… */
  const FIXED_ROOM_ID = "thingyan2026";
  const FIREBASE_WRITE_MS = 900;

  const mapEl = document.getElementById("map");
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");
  const btnCopy = document.getElementById("btn-copy");
  const btnLocate = document.getElementById("btn-locate");
  const toast = document.getElementById("toast");
  const roomStatusEl = document.getElementById("room-status");
  const distanceWaitingEl = document.getElementById("distance-info-waiting");
  const distanceActiveEl = document.getElementById("distance-info-active");
  const distanceListEl = document.getElementById("distance-list");

  function isFirebaseConfigured() {
    const k = firebaseConfig && firebaseConfig.apiKey;
    return (
      typeof k === "string" &&
      k.length > 0 &&
      !k.includes("YOUR_") &&
      firebaseConfig.databaseURL &&
      !String(firebaseConfig.databaseURL).includes("YOUR_")
    );
  }

  function generateUserId() {
    try {
      if (crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {
      /* ignore */
    }
    return "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function parseUrl() {
    const p = new URLSearchParams(window.location.search);
    const lat = parseFloat(p.get("lat"));
    const lng = parseFloat(p.get("lng"));
    const z = parseInt(p.get("z"), 10);
    const mlat = parseFloat(p.get("mlat"));
    const mlng = parseFloat(p.get("mlng"));
    return {
      lat: Number.isFinite(lat) ? lat : DEFAULT.lat,
      lng: Number.isFinite(lng) ? lng : DEFAULT.lng,
      z: Number.isFinite(z) && z >= 1 && z <= 19 ? z : DEFAULT.z,
      marker:
        Number.isFinite(mlat) && Number.isFinite(mlng)
          ? { lat: mlat, lng: mlng }
          : null,
    };
  }

  function buildShareUrl(state) {
    const u = new URL(window.location.origin + window.location.pathname);
    if (state.room) u.searchParams.set("room", state.room);
    u.searchParams.set("lat", state.lat.toFixed(6));
    u.searchParams.set("lng", state.lng.toFixed(6));
    u.searchParams.set("z", String(state.z));
    if (state.marker) {
      u.searchParams.set("mlat", state.marker.lat.toFixed(6));
      u.searchParams.set("mlng", state.marker.lng.toFixed(6));
    }
    return u.toString();
  }

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 2400);
  }

  function coloredDivIcon(color) {
    return L.divIcon({
      className: "location-pin-marker",
      html:
        '<div style="width:14px;height:14px;border-radius:50%;background:' +
        color +
        ';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  function sanitizeDisplayName(raw) {
    const s = raw == null ? "" : String(raw).trim();
    if (!s) return "Guest";
    return s.length > 40 ? s.slice(0, 40) : s;
  }

  function promptForDisplayName() {
    const input = window.prompt("Enter your name for this room:", "");
    return sanitizeDisplayName(input);
  }

  /** Geodesic distance in meters (Leaflet uses haversine). */
  function distanceMeters(latlngA, latlngB) {
    return L.latLng(latlngA).distanceTo(L.latLng(latlngB));
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters) || meters < 0) return "—";
    if (meters >= 1000) {
      const km = meters / 1000;
      const digits = km >= 100 ? 0 : km >= 10 ? 1 : 2;
      return km.toFixed(digits) + " km";
    }
    return Math.round(meters) + " m";
  }

  const TOOLTIP_OPTS = {
    permanent: true,
    direction: "top",
    offset: [0, -12],
    className: "nametag-tooltip",
  };

  function setMarkerNameTooltip(marker, label) {
    const text = String(label);
    const tt = marker.getTooltip();
    if (tt) {
      tt.setContent(text);
    } else {
      marker.bindTooltip(text, TOOLTIP_OPTS);
    }
  }

  const initial = parseUrl();
  const roomId = FIXED_ROOM_ID;
  let currentRoomId = roomId;

  const url = new URL(window.location.href);
  if (url.searchParams.get("room") !== FIXED_ROOM_ID) {
    url.searchParams.set("room", FIXED_ROOM_ID);
    window.history.replaceState({}, "", url.toString());
  }

  const myUid = generateUserId();
  const myDisplayName = promptForDisplayName();

  const map = L.map(mapEl, { zoomControl: true }).setView(
    [initial.lat, initial.lng],
    initial.z,
  );

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  const myMarker = L.marker([initial.lat, initial.lng], {
    icon: coloredDivIcon("#2563eb"),
    draggable: true,
    autoPan: true,
  }).addTo(map);
  setMarkerNameTooltip(myMarker, myDisplayName + " (you)");

  if (initial.marker) {
    myMarker.setLatLng([initial.marker.lat, initial.marker.lng]);
  } else if (!window.location.search.includes("mlat")) {
    myMarker.setLatLng(map.getCenter());
  }

  const otherMarkers = new Map();
  const otherPolylines = new Map();
  const otherMeta = new Map();

  function refreshDistancePanel() {
    if (!distanceWaitingEl || !distanceActiveEl || !distanceListEl) {
      return;
    }

    distanceListEl.innerHTML = "";
    const myLL = myMarker.getLatLng();

    if (otherMarkers.size === 0) {
      distanceWaitingEl.classList.remove("hidden");
      distanceActiveEl.classList.add("hidden");
      distanceWaitingEl.textContent = isFirebaseConfigured()
        ? "Waiting for others…"
        : "Enable Firebase in app.js to see live distances.";
      return;
    }

    distanceWaitingEl.classList.add("hidden");
    distanceActiveEl.classList.remove("hidden");

    otherMarkers.forEach((mk, uid) => {
      const name = otherMeta.get(uid) || "Guest";
      const d = distanceMeters(myLL, mk.getLatLng());
      const li = document.createElement("li");
      li.className = "leading-snug";
      li.innerHTML =
        '<span class="block font-medium text-slate-100">' +
        escapeHtml(name) +
        '</span><span class="mt-0.5 block text-sm font-semibold tabular-nums text-teal-400">' +
        escapeHtml(formatDistance(d)) +
        "</span>";
      distanceListEl.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateConnectionLines() {
    const myLL = myMarker.getLatLng();
    otherMarkers.forEach((mk, uid) => {
      const otherLL = mk.getLatLng();
      let pl = otherPolylines.get(uid);
      if (!pl) {
        pl = L.polyline([myLL, otherLL], {
          color: "#fb923c",
          weight: 2,
          opacity: 0.88,
          dashArray: "10 10",
          interactive: false,
        }).addTo(map);
        otherPolylines.set(uid, pl);
      } else {
        pl.setLatLngs([myLL, otherLL]);
      }
    });
    const stale = [];
    otherPolylines.forEach((pl, uid) => {
      if (!otherMarkers.has(uid)) stale.push(uid);
    });
    stale.forEach((uid) => {
      const pl = otherPolylines.get(uid);
      if (pl) map.removeLayer(pl);
      otherPolylines.delete(uid);
    });
  }

  function onRelativeGeometryChanged() {
    updateConnectionLines();
    refreshDistancePanel();
  }

  myMarker.on("move", onRelativeGeometryChanged);

  let db = null;
  let usersRef = null;
  let userRef = null;
  let usersListenerUnsub = null;
  let connectedUnsub = null;
  let watchId = null;
  let lastFirebaseWrite = 0;
  let firebaseWriteTimer = null;

  function updateRoomStatus(count) {
    const n = typeof count === "number" ? count : 0;
    const label = n === 1 ? "1 user online" : n + " users online";
    roomStatusEl.textContent = "Room: " + currentRoomId + " | " + label;
  }

  function detachFirebaseListeners() {
    if (usersListenerUnsub) {
      usersListenerUnsub();
      usersListenerUnsub = null;
    }
    if (connectedUnsub) {
      connectedUnsub();
      connectedUnsub = null;
    }
    otherMarkers.forEach((m) => {
      map.removeLayer(m);
    });
    otherMarkers.clear();
    otherPolylines.forEach((pl) => {
      map.removeLayer(pl);
    });
    otherPolylines.clear();
    otherMeta.clear();
    refreshDistancePanel();
  }

  function bindRoom(room) {
    currentRoomId = room;
    detachFirebaseListeners();

    if (!isFirebaseConfigured()) {
      updateRoomStatus(1);
      roomStatusEl.textContent =
        "Room: " + currentRoomId + " | Configure Firebase in js/app.js to sync";
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();

    usersRef = db.ref("rooms/" + room + "/users");
    userRef = usersRef.child(myUid);
    userRef.onDisconnect().remove();

    connectedUnsub = function () {
      db.ref(".info/connected").off("value");
    };
    db.ref(".info/connected").on("value", (snap) => {
      if (snap.val() === true) {
        userRef.onDisconnect().remove();
      }
    });

    const onUsers = (snap) => {
      const val = snap.val() || {};
      const keys = Object.keys(val);
      updateRoomStatus(keys.length);

      keys.forEach((uid) => {
        if (uid === myUid) return;
        const o = val[uid];
        const lat = o && typeof o.lat === "number" ? o.lat : parseFloat(o.lat);
        const lng = o && typeof o.lng === "number" ? o.lng : parseFloat(o.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const displayName = sanitizeDisplayName(o && o.name);

        let mk = otherMarkers.get(uid);
        if (!mk) {
          mk = L.marker([lat, lng], {
            icon: coloredDivIcon("#dc2626"),
            draggable: false,
          }).addTo(map);
          otherMarkers.set(uid, mk);
          setMarkerNameTooltip(mk, displayName);
        } else {
          mk.setLatLng([lat, lng]);
          setMarkerNameTooltip(mk, displayName);
        }
        otherMeta.set(uid, displayName);
      });

      otherMarkers.forEach((mk, uid) => {
        if (!val[uid]) {
          map.removeLayer(mk);
          otherMarkers.delete(uid);
          const pl = otherPolylines.get(uid);
          if (pl) {
            map.removeLayer(pl);
            otherPolylines.delete(uid);
          }
          otherMeta.delete(uid);
        }
      });

      onRelativeGeometryChanged();
    };

    usersRef.on("value", onUsers);
    usersListenerUnsub = function () {
      usersRef.off("value", onUsers);
    };

    flushMyPositionToFirebase(true);
  }

  function scheduleFirebaseWrite() {
    const now = Date.now();
    const delta = now - lastFirebaseWrite;
    if (delta >= FIREBASE_WRITE_MS) {
      flushMyPositionToFirebase(false);
      return;
    }
    if (firebaseWriteTimer) return;
    firebaseWriteTimer = setTimeout(() => {
      firebaseWriteTimer = null;
      flushMyPositionToFirebase(false);
    }, FIREBASE_WRITE_MS - delta);
  }

  function flushMyPositionToFirebase(force) {
    if (!isFirebaseConfigured() || !userRef) return;
    const ll = myMarker.getLatLng();
    const payload = {
      lat: ll.lat,
      lng: ll.lng,
      name: myDisplayName,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
    };
    lastFirebaseWrite = Date.now();
    const p = userRef.set(payload);
    if (force && p && typeof p.catch === "function") {
      p.catch(() => showToast("Could not write to Firebase"));
    }
  }

  let skipNextMoveEnd = false;

  function pushHistoryFromMap() {
    const c = map.getCenter();
    const z = map.getZoom();
    const m = myMarker.getLatLng();
    const state = {
      room: currentRoomId,
      lat: c.lat,
      lng: c.lng,
      z,
      marker: { lat: m.lat, lng: m.lng },
    };
    window.history.replaceState(state, "", buildShareUrl(state));
  }

  map.on("moveend", () => {
    if (skipNextMoveEnd) {
      skipNextMoveEnd = false;
      return;
    }
    pushHistoryFromMap();
  });

  map.on("click", (e) => {
    myMarker.setLatLng(e.latlng);
    pushHistoryFromMap();
    flushMyPositionToFirebase(true);
  });

  myMarker.on("dragend", () => {
    pushHistoryFromMap();
    flushMyPositionToFirebase(true);
  });

  btnCopy.addEventListener("click", async () => {
    const c = map.getCenter();
    const z = map.getZoom();
    const m = myMarker.getLatLng();
    const link = buildShareUrl({
      room: currentRoomId,
      lat: c.lat,
      lng: c.lng,
      z,
      marker: { lat: m.lat, lng: m.lng },
    });
    try {
      await navigator.clipboard.writeText(link);
      showToast("Link copied (includes room)");
    } catch {
      prompt("Copy this link:", link);
    }
  });

  btnLocate.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported");
      return;
    }
    btnLocate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        skipNextMoveEnd = true;
        map.setView([lat, lng], Math.max(map.getZoom(), 14));
        myMarker.setLatLng([lat, lng]);
        pushHistoryFromMap();
        flushMyPositionToFirebase(true);
        btnLocate.disabled = false;
        showToast("Map centered on you");
      },
      () => {
        btnLocate.disabled = false;
        showToast("Could not get your location");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  function startWatchPosition() {
    if (!navigator.geolocation) return;
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        myMarker.setLatLng([lat, lng]);
        if (isFirebaseConfigured() && userRef) {
          scheduleFirebaseWrite();
        }
      },
      () => {
        /* silent: permission or errors; Locate still available */
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  window.addEventListener("beforeunload", () => {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  });

  let searchDebounce;
  let searchAbort;

  function hideResults() {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      hideResults();
      return;
    }
    searchDebounce = setTimeout(() => runSearch(q), 350);
  });

  document.addEventListener("click", (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      hideResults();
    }
  });

  async function runSearch(q) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    const url = new URL(NOMINATIM);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "6");
    try {
      const res = await fetch(url.toString(), {
        signal: searchAbort.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      renderResults(data);
    } catch (e) {
      if (e.name === "AbortError") return;
      showToast("Search failed — try again");
      hideResults();
    }
  }

  function renderResults(items) {
    searchResults.innerHTML = "";
    if (!items.length) {
      searchResults.classList.remove("hidden");
      const li = document.createElement("li");
      li.className = "px-3 py-2 text-sm text-slate-500";
      li.textContent = "No results";
      searchResults.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className =
        "cursor-pointer px-3 py-2 text-sm text-slate-200 hover:bg-slate-800";
      li.textContent = item.display_name;
      li.addEventListener("click", () => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        skipNextMoveEnd = true;
        map.setView([lat, lng], 15);
        myMarker.setLatLng([lat, lng]);
        pushHistoryFromMap();
        flushMyPositionToFirebase(true);
        searchInput.value = "";
        hideResults();
      });
      searchResults.appendChild(li);
    });
    searchResults.classList.remove("hidden");
  }

  bindRoom(roomId);
  pushHistoryFromMap();
  startWatchPosition();
  onRelativeGeometryChanged();

  if (!isFirebaseConfigured()) {
    showToast("Add your Firebase config in js/app.js to enable live sync");
  }
})();
