var App = {};
App.Timer = (function(){
    
    let timeInMilliseconds;
    if(performance){
        timeInMilliseconds = ()=> {return performance.now();};
    }
    else{
        timeInMilliseconds = ()=> {return Date.now();};
    }
    
    function timeFunctionBase(functionToTime, done){
        const start = timeInMilliseconds();
        functionToTime();
        const end = timeInMilliseconds();
        const seconds = (end - start) / 1000;
        done(seconds);
    }
    
    function timeFunctionMegapixels(name, numPixels, functionToTime){
		let message;
        timeFunctionBase(functionToTime, (seconds)=>{
			message = megapixelsMessage(name, numPixels, seconds);
            console.log(message);
		});
		return message;
    }
    
    function megapixelsMessage(name, numPixels, seconds){
        const megapixels = numPixels / 1000000;
        const megapixelsPerSecond = megapixels / seconds;
        return `${name}: ${seconds}s, ${megapixelsPerSecond.toFixed(2)} megapixels/s`;
    }
    
    return {
        megapixelsPerSecond: timeFunctionMegapixels,
    };
})();



let wasmExports;
const displayCanvas = document.getElementById('display-canvas');
const displayCanvasContext = displayCanvas.getContext('2d');
const imageElement = document.createElement('img');
let currentImageObjectUrl;

WebAssembly.instantiateStreaming(fetch('js/dither.wasm'), {})
	.then(wasmResults => {
		wasmExports = wasmResults.instance.exports;
		document.documentElement.classList.remove('loading');
	}).catch((e)=>{
		console.log(e);
		document.getElementById('status-message').textContent = "Looks like something went wrong, or your browser does not support WebAssembly.";
	});

document.getElementById('image-file-input').addEventListener('change', (e)=>{
	const files = e.target.files;
	if(files.length < 1){
		return window.alert('No files selected');
	}
	const file = files[0];
	if(!file.type.startsWith('image/')){
		return window.alert(`${file.name} appears to be of type ${file.type} rather than an image`);
	}
	imageElement.onload = ()=> {
		loadImage(imageElement, file);
	};
	if(currentImageObjectUrl){
		URL.revokeObjectURL(currentImageObjectUrl);
	}
	currentImageObjectUrl = URL.createObjectURL(file);
	imageElement.src = currentImageObjectUrl;
	
	this.value = null;
}, false);

function canvasLoadImage(canvas, context, image, scale=1){
	const scaledImageWidth = Math.round(image.width * scale);
	const scaledImageHeight = Math.round(image.height * scale);
	canvas.width = scaledImageWidth;
	canvas.height = scaledImageHeight;
	context.drawImage(image, 0, 0, scaledImageWidth, scaledImageHeight);
}

//pixels should be UInt8ClampedArray
function drawPixels(context, imageWidth, imageHeight, pixels){
	const imageData = context.createImageData(imageWidth, imageHeight);
	imageData.data.set(pixels);
	context.putImageData(imageData, 0, 0);
}

function clearCanvas(context){
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
}


function loadImage(image, file){
	let scaledImageWidth = image.width;
	let scaledImageHeight = image.height;

	//scale image if too large (required for phones)
	const largestDimension = Math.max(scaledImageWidth, scaledImageHeight);
	const maxImageDimension = Math.min(window.innerWidth, 1800);
	const scale = largestDimension > maxImageDimension ? maxImageDimension / largestDimension : 1;
	
	//turn image into arrayBuffer by drawing it and then getting it from canvas
	clearCanvas(displayCanvasContext);
	canvasLoadImage(displayCanvas, displayCanvasContext, image, scale);
	scaledImageWidth = displayCanvas.width;
	scaledImageHeight = displayCanvas.height;
	const pixels = new Uint8Array(displayCanvasContext.getImageData(0, 0, scaledImageWidth, scaledImageHeight).data.buffer);

	const imageByteSize = scaledImageWidth * scaledImageHeight * 4;
	const memoryPageSize = 64 * 1024;
	
	//setting memory from: https://stackoverflow.com/questions/46748572/how-to-access-webassembly-linear-memory-from-c-c
	const currentMemorySize = wasmExports.memory.buffer.byteLength;
	//extra memory in bytes to store up to 16*16 bayer matrix of floats, floats in D are 32 bit
	const extraMemoryForHeap = 4 * 256;
	const totalMemoryRequired = pixels.length + extraMemoryForHeap;
	//see if we need to grow memory
	if(totalMemoryRequired > currentMemorySize){
		//https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory/grow
		//grow will add amount * pageSize to total memory
		const growthAmount = Math.ceil((totalMemoryRequired - currentMemorySize) / memoryPageSize);
		wasmExports.memory.grow(growthAmount);
	}
	//load image into memory
	const wasmHeap = new Uint8ClampedArray(wasmExports.memory.buffer);
	wasmHeap.set(pixels);
	//figure out how much heap memory there is, and it's offset
	const heapOffset = imageByteSize;
	const heapSize = wasmHeap.length - imageByteSize;
	//dither image
	const performanceResults = App.Timer.megapixelsPerSecond('Ordered dithering performance', scaledImageWidth * scaledImageHeight, ()=>{
		wasmExports.dither(scaledImageWidth, scaledImageHeight, heapOffset, heapSize);
	});
	//dithered image is now in the wasmHeap
	
	//draw result on canvas
	//can't use pixels.length, because buffer might be bigger than actual pixels
	const ditherResultPixels = wasmHeap.subarray(0, scaledImageWidth * scaledImageHeight * 4);
	clearCanvas(displayCanvasContext);
	drawPixels(displayCanvasContext, scaledImageWidth, scaledImageHeight, ditherResultPixels);

	//display performance results
	document.getElementById('performance-results').textContent = performanceResults;
}