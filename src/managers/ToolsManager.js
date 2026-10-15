
class ToolsManager {

    constructor() {
        this.ToolPanel = document.getElementById("tool-panel");
        this.app = null;
        this.initialized = false;   
    }

    getTool(title = "",cssClasses = [],onClick = () => {}){
        let tool = document.createElement("button");
        tool.type = "button";
        tool.title = title;
        tool.classList.add("tool");
        
        let toolIcon = document.createElement("i");
        toolIcon.classList.add(...cssClasses);
        
        toolIcon.style.fontSize = "30px";
        
        tool.appendChild(toolIcon);
        
        tool.addEventListener('click', () => {
           onClick(); 
        });
        
        return tool;
    }
    
    getColorPicker(title){
                                       
        const colorPicker = document.createElement("input");

        colorPicker.type = "color";
        colorPicker.title = title;
        colorPicker.classList.add("tool");
        colorPicker.value = "#ffffff";
        colorPicker.style.width = "100%";
        
        colorPicker.getDecimal = function() {
            const cleanHex = colorPicker.value.replace('#', '');
            return parseInt(cleanHex, 16);
        };
        
        return colorPicker;
    }
    
    addTool(tool){
        this.ToolPanel.appendChild(tool);
    }
    
    addToolGroup(title,cssClasses = [], tools = []) {

        const group = document.createElement("div");
        group.classList.add("tool-group");

        const button = document.createElement("button");
        button.type = "button";
        button.title = title;
        button.classList.add("tool", "tool-group-button");

        const icon = document.createElement("i");
        icon.classList.add(...cssClasses);

        icon.style.fontSize = "22px";
        
        const expandIcon = document.createElement("i");
        expandIcon.classList.add(
            "fa-solid",
            "fa-caret-down",
            "tool-group-expand"
        );

        button.appendChild(icon);
        button.appendChild(expandIcon);

        const popup = document.createElement("div");
        popup.classList.add("tool-group-popup");

        for (const tool of tools) {
            tool.addEventListener('click', () => {
               closePopup(); 
            });
            
            popup.appendChild(tool);
        }

        group.appendChild(button);
        group.appendChild(popup);


        const closePopup = () => {
            popup.classList.remove("open");
        };


        button.addEventListener("click", (event) => {
            event.stopPropagation();

            popup.classList.toggle("open");
        });


        popup.addEventListener("click", (event) => {
            event.stopPropagation();

            if (event.target.closest(".tool-placeholder")) {
                closePopup();
            }
        });


        document.addEventListener("click", () => {
            closePopup();
        });

        this.ToolPanel.appendChild(group);

        //return group;
    }

}

export default new ToolsManager();