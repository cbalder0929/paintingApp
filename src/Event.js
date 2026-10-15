export class Event {

    constructor() {
        this.listeners = [];
    }

    addListener(listener) {
        this.listeners.push(listener);    
    }

    removeListener(listener) {
        this.listeners = this.listeners.filter(
            item => item !== listener
        );
    }

    invoke(args) {
        const listeners = [...this.listeners];

        for (const listener of listeners) {
            listener(args);
        }
    }

}