from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import Optional
from app.core.websocket_manager import ws_manager

router = APIRouter()

@router.websocket("/ws")
@router.websocket("/ws/")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    await ws_manager.connect(websocket, token=token)
    try:
        while True:
            data = await websocket.receive_text()
            await ws_manager.handle_client_message(websocket, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        import logging
        logging.getLogger("websockets").error(f"WebSocket unhandled error: {e}", exc_info=True)
        ws_manager.disconnect(websocket)

