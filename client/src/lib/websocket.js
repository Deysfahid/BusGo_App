import { Client } from '@stomp/stompjs';

// Same rule as api.js: same-origin by default (the dev server proxies /ws to the
// backend), using wss:// when the page itself is served over https. window.location.host
// keeps the page's port, so phone testing over the LAN needs no config.
// Deployments set VITE_WS_URL to the backend's wss:// endpoint.
const defaultWsUrl =
    typeof window !== 'undefined'
        ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
        : 'ws://localhost:8080/ws';

const WEBSOCKET_URL = import.meta.env.VITE_WS_URL || defaultWsUrl;

let stompClient = null;
// The token the live client authenticated with. Guests connect anonymously and
// may only subscribe; publishing a bus position needs a conductor/admin token,
// so if the token changes (guest browses, then a conductor logs in) the socket
// has to be rebuilt or the conductor's publishes would be rejected as anonymous.
let stompClientToken = null;

const currentToken = () => {
    try {
        return localStorage.getItem('busgo_token');
    } catch {
        return null; // private mode / storage disabled
    }
};

export const connectWebSocket = (onConnectCallback) => {
    const token = currentToken();

    // Identity changed since this socket was opened - start a fresh one.
    if (stompClient && stompClientToken !== token) {
        stompClient.deactivate();
        stompClient = null;
        stompClientToken = null;
    }

    // If already connected, immediately call callback and return
    if (stompClient && stompClient.connected) {
        if (onConnectCallback) onConnectCallback(stompClient);
        return stompClient;
    }

    // If a client exists but is still connecting, don't recreate it - just make
    // sure this callback also runs once the existing activation completes.
    if (stompClient) {
        const originalOnConnect = stompClient.onConnect;
        stompClient.onConnect = (frame) => {
            if (originalOnConnect) originalOnConnect(frame);
            if (onConnectCallback) onConnectCallback(stompClient);
        };
        return stompClient;
    }

    stompClient = new Client({
        brokerURL: WEBSOCKET_URL,
        // Sent on the STOMP CONNECT frame; the backend's channel interceptor reads
        // it to identify the conductor. Absent for guests, who can still subscribe.
        connectHeaders: token ? { Authorization: `Bearer ${token}` } : {},
        reconnectDelay: 5000,
        heartbeatIncoming: 4000,
        heartbeatOutgoing: 4000,
    });
    stompClientToken = token;

    stompClient.onConnect = (frame) => {
        console.log('[WS] connected', token ? '(authenticated)' : '(guest)', frame.headers);
        if (onConnectCallback) {
            onConnectCallback(stompClient);
        }
    };

    stompClient.onStompError = (frame) => {
        console.error('[WS] broker error: ' + frame.headers['message']);
        console.error('[WS] details: ' + frame.body);
    };

    stompClient.activate();
    return stompClient;
};

export const disconnectWebSocket = () => {
    if (stompClient !== null) {
        stompClient.deactivate();
        stompClient = null;
        stompClientToken = null;
    }
    console.log('[WS] disconnected');
};

export const getStompClient = () => stompClient;
