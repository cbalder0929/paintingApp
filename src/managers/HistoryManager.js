import { Event } from "../Event.js";

const MAX_HISTORY = 100;

// A command is any object with undo() and redo() methods.
class HistoryManager {

    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.changed = new Event();
    }

    get canUndo() {
        return this.undoStack.length > 0;
    }

    get canRedo() {
        return this.redoStack.length > 0;
    }

    // Records a command whose effect has already been applied (e.g. a finished drag).
    push(command) {
        this.undoStack.push(command);

        if (this.undoStack.length > MAX_HISTORY) {
            this.undoStack.shift();
        }

        this.redoStack.length = 0;
        this.changed.invoke(this);
    }

    // Applies a command and records it.
    execute(command) {
        command.redo();
        this.push(command);
    }

    undo() {
        const command = this.undoStack.pop();
        if (!command) return;

        command.undo();
        this.redoStack.push(command);
        this.changed.invoke(this);
    }

    redo() {
        const command = this.redoStack.pop();
        if (!command) return;

        command.redo();
        this.undoStack.push(command);
        this.changed.invoke(this);
    }

}

export default new HistoryManager();
