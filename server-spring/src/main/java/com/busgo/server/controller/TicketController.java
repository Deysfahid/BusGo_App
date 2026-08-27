package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.entity.Ticket;
import com.busgo.server.service.TicketService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/tickets")
@RequiredArgsConstructor
public class TicketController {

    private final TicketService ticketService;

    @GetMapping("/trip/{tripId}")
    public ResponseEntity<ApiResponse<List<Ticket>>> getTicketsByTripId(@PathVariable Long tripId) {
        return ResponseEntity.ok(ApiResponse.success(ticketService.getTicketsByTripId(tripId)));
    }

    @PostMapping("/issue")
    public ResponseEntity<ApiResponse<Ticket>> issueTicket(@RequestBody com.busgo.server.dto.IssueTicketRequest request) {
        return ResponseEntity.ok(ApiResponse.success(ticketService.issueTicket(request)));
    }

}
