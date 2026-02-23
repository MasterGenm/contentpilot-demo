# components/remote_agent_monitor.py
"""
Remote Agent 监控组件
显示远程代理的状态和任务调度情况
"""

import mesop as me
from state.state import AppState


def render_agent_monitor_button():
    """渲染代理监控按钮"""
    state = me.state(AppState)
    
    me.button(
        "🔧 代理监控",
        on_click=toggle_agent_monitor,
        style=me.Style(
            background="#f5f5f5",
            color="#424242",
            border=me.Border.all(
                me.BorderSide(width=1, color="#e0e0e0", style="solid")
            ),
            border_radius=20,
            padding=me.Padding(top=8, bottom=8, left=16, right=16),
            font_size=14,
            font_weight=500,
            cursor="pointer",
            margin=me.Margin(left=8)
        )
    )


def toggle_agent_monitor(e: me.ClickEvent):
    """切换代理监控面板"""
    state = me.state(AppState)
    state.remote_agent_monitor_open = not state.remote_agent_monitor_open


def render_agent_monitor_panel():
    """渲染代理监控面板"""
    state = me.state(AppState)
    
    if not state.remote_agent_monitor_open:
        return
    
    with me.box(
        style=me.Style(
            position="fixed",
            top=80,
            right=20,
            width=400,
            max_height="80vh",
            background="#ffffff",
            border_radius=12,
            box_shadow="0 4px 16px rgba(0,0,0,0.15)",
            overflow_y="auto",
            z_index=999,
            padding=me.Padding.all(16)
        )
    ):
        # 头部
        with me.box(
            style=me.Style(
                display="flex",
                justify_content="space-between",
                align_items="center",
                margin=me.Margin(bottom=16),
                padding=me.Padding(bottom=12),
                border=me.Border(
                    bottom=me.BorderSide(width=1, color="#e0e0e0", style="solid")
                )
            )
        ):
            me.text(
                "🔧 Remote Agent 监控",
                style=me.Style(
                    font_size=18,
                    font_weight=600
                )
            )
            
            me.button(
                "✕",
                on_click=toggle_agent_monitor,
                style=me.Style(
                    background="transparent",
                    border=me.Border.all(me.BorderSide(width=0)),
                    font_size=20,
                    cursor="pointer",
                    padding=me.Padding.all(4)
                )
            )
        
        # 自动调度开关
        with me.box(
            style=me.Style(
                background="#f5f5f5",
                border_radius=8,
                padding=me.Padding.all(12),
                margin=me.Margin(bottom=16)
            )
        ):
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="space-between",
                    align_items="center"
                )
            ):
                me.text(
                    "自动调度",
                    style=me.Style(
                        font_size=14,
                        font_weight=500
                    )
                )
                
                # 简化的开关显示
                status_text = "✓ 开启" if state.auto_dispatch_enabled else "✗ 关闭"
                status_color = "#4caf50" if state.auto_dispatch_enabled else "#9e9e9e"
                
                me.text(
                    status_text,
                    style=me.Style(
                        color=status_color,
                        font_size=14,
                        font_weight=600
                    )
                )
        
        # 代理状态列表
        me.text(
            "代理状态",
            style=me.Style(
                font_size=16,
                font_weight=600,
                margin=me.Margin(bottom=12)
            )
        )
        
        # 示例代理状态卡片
        render_agent_status_card("在线搜索代理", "online_search", "available", 0.2, 1, 5)
        render_agent_status_card("Web自动化代理", "playwright", "available", 0.0, 0, 3)
        render_agent_status_card("Naga门户代理", "naga_portal", "available", 0.0, 0, 2)
        render_agent_status_card("天气时间代理", "weather_time", "available", 0.0, 0, 5)


def render_agent_status_card(
    display_name: str,
    agent_id: str,
    status: str,
    load: float,
    active_tasks: int,
    max_tasks: int
):
    """渲染单个代理状态卡片"""
    
    # 状态颜色映射
    status_colors = {
        "available": "#4caf50",
        "busy": "#ff9800",
        "error": "#f44336",
        "offline": "#9e9e9e"
    }
    
    status_text_map = {
        "available": "可用",
        "busy": "繁忙",
        "error": "错误",
        "offline": "离线"
    }
    
    with me.box(
        style=me.Style(
            border=me.Border.all(
                me.BorderSide(width=1, color="#e0e0e0", style="solid")
            ),
            border_radius=8,
            padding=me.Padding.all(12),
            margin=me.Margin(bottom=8)
        )
    ):
        # 代理名称和状态
        with me.box(
            style=me.Style(
                display="flex",
                justify_content="space-between",
                align_items="center",
                margin=me.Margin(bottom=8)
            )
        ):
            me.text(
                display_name,
                style=me.Style(
                    font_size=14,
                    font_weight=600
                )
            )
            
            me.text(
                status_text_map.get(status, "未知"),
                style=me.Style(
                    color=status_colors.get(status, "#9e9e9e"),
                    font_size=12,
                    font_weight=500
                )
            )
        
        # 负载信息
        me.text(
            f"任务: {active_tasks}/{max_tasks} | 负载: {int(load*100)}%",
            style=me.Style(
                font_size=12,
                color="#666",
                margin=me.Margin(bottom=4)
            )
        )
        
        # 负载进度条
        with me.box(
            style=me.Style(
                width="100%",
                height=4,
                background="#e0e0e0",
                border_radius=2,
                overflow="hidden"
            )
        ):
            me.box(
                style=me.Style(
                    width=f"{int(load*100)}%",
                    height="100%",
                    background=status_colors.get(status, "#9e9e9e"),
                    transition="width 0.3s ease"
                )
            )

