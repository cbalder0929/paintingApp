class Utils {

    constructor() {

    }
    
    removeFromArray(arr,obj){

		const index = arr.indexOf(obj);
		if (index > -1) {
			arr.splice(index, 1);
		}

		return arr;

	}
    
    existsInArray(arr,obj){

		const index = arr.indexOf(obj);
		return index > -1;

	}
    
    checkAABB(rect1, rect2) {
        
        let rect1HalfWidth = rect1.width/2;
        let rect1HalfHeight = rect1.height/2;
        let rect2HalfWidth = rect2.width/2;
        let rect2HalfHeight = rect2.height/2;
        
        return rect1.x - rect1HalfWidth < rect2.x + rect2HalfWidth &&
               rect1.x + rect1HalfWidth > rect2.x - rect2HalfWidth &&
               rect1.y - rect1HalfHeight < rect2.y + rect2HalfHeight &&
               rect1.y + rect1HalfHeight > rect2.y - rect2HalfHeight;
    }

}

export default new Utils();