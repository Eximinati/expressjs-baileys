import makeWASocket, { DisconnectReason, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys';
// import QRCode from 'qrcode';
import {
    readFileSync
} from 'fs';
import { Attachment, ConnectionState, PreparedPhotoFile, PreparedVideoFile, PreparedDocumentFile } from './type';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import { downloadTempRemoteFile } from './../../utils';
import AuthenticationFromDatabase from '../../authSession/authentication';
import DatabaseHandler from '../../authSession/databaseMethods';
// const { exec } = require("child_process");
// const pathToFfmpeg = require('ffmpeg-static');

interface ConnectionObject {
    [key: string]: WASocket;
}

export default class WhatsApp extends EventEmitter {
    private connections: ConnectionObject;
    private credId: string;
    private state: ConnectionState;
    private database = new DatabaseHandler();
    constructor(credId: string) {
        super();
        this.credId = credId;
        this.state = ConnectionState.idle;
        this.connections = {};
    }

    getCredId(): string {
        return this.credId;
    }

    getConnections(): { [key: string]: WASocket } {
        return this.connections;
    }

    findConnection(): WASocket | null {
        return this.connections[this.credId] ? this.connections[this.credId] : null;
    }

    setConnection(sock: WASocket): WASocket {
        return (this.connections[this.credId] = sock);
    }

    async removeConnection(): Promise<void> {
        const { removeSession } = new DatabaseHandler();
        await removeSession(this.credId);
    }

    forceReset(): Promise<null> {
        return new Promise(async (resolve) => {
            // (async () => {
            await this.removeConnection();
            return resolve(null);
            // })()
        });
    }

    async setState(state: ConnectionState) {
        if (state !== this.state) {
            this.state = state;
            this.triggerEvent('state', state);
        }
    }

    async getState(): Promise<ConnectionState> {
        return Promise.resolve(this.state);
    }

    private triggerEvent(eventName: string, value: any): void {
        this.emit(`service.whatsapp.${eventName}`, value);
    }

    async initializeConnection(): Promise<WASocket | null> {
        const database = new DatabaseHandler();
        const { useDatabaseAuth } = new AuthenticationFromDatabase(this.credId, database);
        const { state, saveState } = await useDatabaseAuth();
        const sock = makeWASocket({
            syncFullHistory: false,
            printQRInTerminal: true,
            auth: state,
            generateHighQualityLinkPreview: true,
        });
        this.generateQR(sock);

        sock.ev.on('creds.update', saveState);

        this.setConnection(sock);
        return this.findConnection();
    }

    async generateQR(sock: WASocket): Promise<string> {
        return new Promise((resolve, reject) => {
            sock.ev.on('connection.update', async (update) => {
    if (update.connection === 'open') {
        this.setState(ConnectionState.connected);
    }

    else if (update.connection === 'close') {
        const shouldReconnect =
            (update.lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log(
            'connection closed due to ',
            update.lastDisconnect?.error,
            ', reconnecting ',
            shouldReconnect
        );

        if (shouldReconnect) {
            this.setState(ConnectionState.connected);
        } else {
            this.setState(ConnectionState.disconnected);
        }
    }

    if (update.isNewLogin) {
        this.initializeConnection();
    }

    if (update.qr) {
        this.setState(ConnectionState.disconnected);
        this.triggerEvent('qr', { qr: update.qr });
        resolve(update.qr);
    }
});

        });
    }

    async connect(): Promise<WASocket | null> {
        return new Promise(async (resolve, reject) => {
            // (async () => {
            try {
                await this.database.connect();
                let sock = this.findConnection();
                // this.setState(ConnectionState.idle)

                if (!sock) {
                    // console.log('initializeConnection')
                    sock = await this.initializeConnection();
                }

                setTimeout(async () => {
                    // console.log('state', await this.getState());
                    this.triggerEvent('state', await this.getState());
                }, 3000);

                resolve(sock);
            } catch (error) {
                reject(error);
            }
            // })()
        });
    }

    async disconnect(): Promise<null> {
        // this.setState(ConnectionState.idle)
        return new Promise((resolve, reject) => {
            try {
                this.removeConnection();
                resolve(null);
                // delete folder wa-bot-info
            } catch (error) {
                reject(error);
            }
        });
        // setTimeout(() => {
        //   this.setState(ConnectionState.disconnected)
        // }, 1500);
    }

    async checkConnection(): Promise<ConnectionState> {
        return new Promise(async (resolve, reject) => {
            // (async () => {
            try {
                const conn = this.findConnection();
                const state = await this.getState();
                if (state === ConnectionState.idle) {
                    return reject('waiting for connection');
                }
                if (state === ConnectionState.disconnected || !conn) {
                    return reject('no active connection found');
                }
                return resolve(state);
            } catch (error) {
                return reject(error);
            }
            // })()
        });
    }

async sendTextMessage(destinationNumber: string, messageContent: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        try {
            if (!destinationNumber || !messageContent) {
                return reject('missing required parameters');
            }

            const formattedRecipient = `${destinationNumber}@c.us`;
            if (!/^[\d]+@c.us$/.test(formattedRecipient)) {
                return reject('invalid recipient format');
            }

            const conn = this.findConnection();
            const state = await this.getState();
            if (state === ConnectionState.idle) {
                return reject('waiting for connection');
            }
            if (state === ConnectionState.disconnected || !conn) {
                return reject('no active connection found');
            }

            const [result] = await conn.onWhatsApp(formattedRecipient);

            if (!result || !result.exists) {
                return reject('number not exists');
            }

            await conn.sendMessage(formattedRecipient, { text: messageContent });
            return resolve(`success send message to ${formattedRecipient} with message ${messageContent}`);
        } catch (error) {
            return reject(error);
        }
    });
}


    async sendMediaMessage(destinationNumber: string, file: Attachment, messageContent: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            // (async () => {
            try {
                if (!destinationNumber || !file || !file.url) {
                    return reject('missing required parameters');
                }

                const formattedRecipient = `${destinationNumber}@c.us`;
                if (!/^[\d]+@c.us$/.test(formattedRecipient)) {
                    return reject('invalid recipient format');
                }

                const conn = this.findConnection();
                const state = await this.getState();
                if (state === ConnectionState.idle) {
                    return reject('waiting for connection');
                }
                if (state === ConnectionState.disconnected || !conn) {
                    return reject('no active connection found');
                }

                const [result] = await conn.onWhatsApp(formattedRecipient);
                if (!result.exists) {
                    return reject('number not exists');
                }

                const savedFile = await downloadTempRemoteFile(this.getCredId(), file.url, file.name);
                // console.log('savedFile', savedFile)

                if (file.type === 'photo') {
                    await conn.sendMessage(formattedRecipient, {
                        image: readFileSync(savedFile),
                        // image: { url: file.url },
                        caption: messageContent,
                        // gifPlayback: true
                    });
                }

                return resolve(`success send message to ${formattedRecipient} with media ${file.url}`);
            } catch (error) {
                return reject(error);
            }
            // })()
        });
    }
}
