import { Client } from '@stomp/stompjs';

const WEBSOCKET_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';

let stompClient = null;

export const connectWebSocket = (onConnectCallback) => {
    // If already connected, immediately call callback and return
    if (stompClient && stompClient.connected) {
        if (onConnectCallback) onConnectCallback(stompClient);
        return stompClient;
    }

    // If client exists but is still connecting, just append callback logic
    // by overriding or we could just rely on the existing onConnect.
    // For simplicity, if stompClient exists at all, don't recreate it!
    if (stompClient) {
        // We shouldn't recreate it. Just let the original activation finish.
        // But we need to make sure the callback runs when it connects.
        const originalOnConnect = stompClient.onConnect;
        stompClient.onConnect = (frame) => {
            if (originalOnConnect) originalOnConnect(frame);
            if (onConnectCallback) onConnectCallback(stompClient);
        };
        return stompClient;
    }

    // Only create a new client if one doesn't exist
    stompClient = new Client({
        brokerURL: WEBSOCKET_URL,
        reconnectDelay: 5000,
        heartbeatIncoming: 4000,
        heartbeatOutgoing: 4000,
    });

    stompClient.onConnect = (frame) => {
        console.log('Connected to WebSocket:', frame);
        if (onConnectCallback) {
            onConnectCallback(stompClient);
        }
    };

    stompClient.onStompError = (frame) => {
        console.error('Broker reported error: ' + frame.headers['message']);
        console.error('Additional details: ' + frame.body);
    };

    stompClient.activate();
    return stompClient;
};

export const disconnectWebSocket = () => {
    if (stompClient !== null) {
        stompClient.deactivate();
        stompClient = null;
    }
    console.log('Disconnected from WebSocket');
};

export const getStompClient = () => stompClient;
